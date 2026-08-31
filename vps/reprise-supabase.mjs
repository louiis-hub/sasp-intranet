// Reprise de Supabase vers SQLite
//
//   node reprise-supabase.mjs [--vers /var/sasp/sasp.db] [--refaire]
//
// A lancer sur le VPS, en root : /etc/sasp/api.env est en 600 root:root.
//   sudo bash -c 'set -a; . /etc/sasp/api.env; set +a; node /opt/sasp/vps/reprise-supabase.mjs'
//   sudo chown -R sasp:sasp /var/sasp
//
// Le chown final n'est pas optionnel : la base est creee par root, mais
// c'est le service sasp-api, qui tourne sous sasp, qui devra y ecrire.
//
// Le schema n'est pas devine : PostgREST publie la description de toutes
// ses tables a la racine de /rest/v1/. On la lit, on en tire le schema
// SQLite, on transfere, puis on compare les comptes table par table.
//
// Rejouable autant de fois qu'on veut. Il n'ECRIT JAMAIS dans Supabase :
// le site tourne pendant ce temps, et une reprise qui ecrit des deux
// cotes produit des divergences que personne ne voit passer.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const URL_SB = process.env.SUPABASE_URL || "https://mjcatmoiwmuxovcigfvz.supabase.co";
const CLE = process.env.SUPABASE_SERVICE_KEY;
if (!CLE) {
  console.error("SUPABASE_SERVICE_KEY absente. Chargez /etc/sasp/api.env d'abord :");
  console.error("  set -a; . /etc/sasp/api.env; set +a");
  process.exit(1);
}

const args = process.argv.slice(2);
const lireArg = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i !== -1 && args[i + 1] ? args[i + 1] : defaut;
};
const FICHIER = lireArg("--vers", "/var/sasp/sasp.db");
const REFAIRE = args.indexOf("--refaire") !== -1;
const PAGE = 1000;   // PostgREST plafonne les reponses

const entetes = { apikey: CLE, authorization: `Bearer ${CLE}` };

async function sb(chemin, extra = {}) {
  const r = await fetch(`${URL_SB}/rest/v1${chemin}`,
    { headers: Object.assign({}, entetes, extra) });
  if (!r.ok) throw new Error(`${chemin} : ${r.status} ${await r.text()}`);
  return r;
}

/* ── 1. le schema, lu chez PostgREST ───────────────────────────────── */
// Format Postgres vers type SQLite. SQLite est souple, mais un type
// declare rend le fichier lisible et documente l'intention.
function typeSqlite(prop) {
  const f = String(prop.format || "");
  if (/^(bigint|integer|smallint|serial|bigserial)$/.test(f)) return "INTEGER";
  if (/^(numeric|double|real|decimal)/.test(f))               return "REAL";
  if (f === "boolean")                                        return "INTEGER";
  if (f === "bytea")                                          return "BLOB";
  return "TEXT";   // texte, dates, uuid, json, jsonb, tableaux
}

async function schema() {
  const r = await sb("/");
  const spec = await r.json();
  const defs = spec.definitions || (spec.components && spec.components.schemas) || {};
  const tables = [];
  for (const [nom, def] of Object.entries(defs)) {
    const props = def.properties || {};
    const colonnes = [];
    for (const [col, p] of Object.entries(props)) {
      const desc = String(p.description || "");
      colonnes.push({
        nom: col,
        type: typeSqlite(p),
        pk: /<pk\/>/.test(desc),
        // PostgREST ne dit pas « not null » directement : il liste les
        // champs requis. Une colonne a valeur par defaut n'y figure pas.
        requis: Array.isArray(def.required) && def.required.indexOf(col) !== -1,
        json: /json/.test(String(p.format || "")) || String(p.type) === "array"
      });
    }
    if (colonnes.length) tables.push({ nom, colonnes });
  }
  return tables.sort((a, b) => a.nom.localeCompare(b.nom));
}

function creer(db, tables) {
  for (const t of tables) {
    const pk = t.colonnes.filter(c => c.pk);
    const lignes = t.colonnes.map(c => {
      let d = `  "${c.nom}" ${c.type}`;
      // Une cle primaire entiere unique devient AUTOINCREMENT implicite :
      // SQLite l'alimente seul, comme le faisait la sequence Postgres.
      if (pk.length === 1 && c.pk && c.type === "INTEGER") d += " PRIMARY KEY";
      else if (c.requis && !c.pk) d += " NOT NULL";
      return d;
    });
    if (pk.length > 1 || (pk.length === 1 && pk[0].type !== "INTEGER")) {
      lignes.push(`  PRIMARY KEY (${pk.map(c => `"${c.nom}"`).join(", ")})`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS "${t.nom}" (\n${lignes.join(",\n")}\n);`);
  }
}

/* ── 2. le transfert ───────────────────────────────────────────────── */
async function compter(table) {
  const r = await sb(`/${table}?select=*`, { prefer: "count=exact", range: "0-0" });
  const cr = r.headers.get("content-range") || "";
  const n = cr.split("/")[1];
  return n === "*" ? null : parseInt(n, 10);
}

async function transferer(db, t) {
  const cols = t.colonnes.map(c => c.nom);
  const jsonCols = new Set(t.colonnes.filter(c => c.json).map(c => c.nom));
  const insert = db.prepare(
    `INSERT OR REPLACE INTO "${t.nom}" (${cols.map(c => `"${c}"`).join(", ")})`
    + ` VALUES (${cols.map(() => "?").join(", ")})`);

  // Une transaction par table : soit tout passe, soit rien. Une table a
  // moitie reprise est pire qu'une table vide, parce qu'elle a l'air
  // correcte.
  const poser = db.transaction(lignes => {
    for (const l of lignes) {
      insert.run(cols.map(c => {
        const v = l[c];
        if (v === undefined || v === null) return null;
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "object") return JSON.stringify(v);
        if (jsonCols.has(c) && typeof v === "string") return v;
        return v;
      }));
    }
  });

  let pris = 0;
  for (let depart = 0; ; depart += PAGE) {
    const r = await sb(`/${t.nom}?select=*&limit=${PAGE}&offset=${depart}`);
    const lignes = await r.json();
    if (!lignes.length) break;
    poser(lignes);
    pris += lignes.length;
    if (lignes.length < PAGE) break;
  }
  return pris;
}

/* ── 3. le deroule ─────────────────────────────────────────────────── */
console.log(`Source : ${URL_SB}`);
console.log(`Cible  : ${FICHIER}\n`);

mkdirSync(dirname(FICHIER), { recursive: true });
const db = new Database(FICHIER);
db.pragma("journal_mode = WAL");

const tables = await schema();
console.log(`${tables.length} tables decrites par PostgREST.\n`);

if (REFAIRE) {
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.nom}"`);
  console.log("Tables existantes supprimees (--refaire).\n");
}
creer(db, tables);

let ecarts = 0, total = 0;
console.log("table                        Supabase   SQLite   ");
console.log("---------------------------- ---------- ---------");
for (const t of tables) {
  let attendu = null, obtenu = 0, note = "";
  try {
    attendu = await compter(t.nom);
    obtenu = await transferer(db, t);
  } catch (e) {
    note = " ECHEC : " + String(e.message).slice(0, 70);
  }
  const reel = db.prepare(`SELECT count(*) n FROM "${t.nom}"`).get().n;
  total += reel;
  // Le compte qui fait foi est celui de SQLite apres transfert, pas le
  // nombre de lignes lues : une contrainte pourrait en rejeter.
  const bon = attendu !== null && reel === attendu && !note;
  if (!bon) ecarts++;
  console.log(
    `${t.nom.padEnd(28)} ${String(attendu ?? "?").padStart(10)} ${String(reel).padStart(8)}`
    + (bon ? "  ok" : "  ECART") + note);
}

console.log(`\n${total} lignes dans ${FICHIER}.`);
if (ecarts) {
  console.log(`\n${ecarts} table(s) ne correspondent pas. NE PAS BASCULER.`);
  console.log("Relancez avec --refaire pour repartir d'une base vide.");
  process.exit(1);
}
console.log("\nTous les comptes correspondent.");
console.log("Vous pouvez poser BASE=sqlite dans /etc/sasp/api.env, puis :");
console.log("  sudo systemctl restart sasp-api");
