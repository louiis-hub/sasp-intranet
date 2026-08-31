// Traduction PostgREST vers SQL, pour SQLite
//
// worker.js construit des chemins PostgREST a 143 endroits. Plutot que de
// reecrire ces 143 appels, on reecrit la seule fonction qui les consomme.
// Ce module traduit ce qu'ils produisent, et rien de plus.
//
// La surface a couvrir a ete mesuree sur le code, pas devinee :
//   eq 77, select 58, limit 50, order 27, on_conflict 7, is 6, not 4,
//   neq 4, in 1, gt 1, ov 1, et AUCUN or=(, and=(, rpc ni offset.
//
// Tout ce qui sortirait de cette surface leve une erreur explicite. Un
// filtre silencieusement ignore rendrait des lignes qu'il fallait exclure,
// et personne ne s'en apercevrait.

// Les deux seules jointures du code, toutes deux a un niveau. PostgREST
// les deduit des cles etrangeres ; SQLite ne nous les donne pas aussi
// simplement, alors on les nomme.
const RELATIONS = {
  "pointages:agents":       { colonne: "agent_id",   cible: "agents" },
  "agents:referent_id":     { colonne: "referent_id", cible: "agents" }
};

// Les colonnes que Postgres stocke en jsonb ou en tableau, et que SQLite
// gardera en texte. Elles se serialisent a l'ecriture et se relisent a la
// lecture, pour que les 143 appels ne voient aucune difference.
export const COLONNES_JSON = {
  ftf_dossiers:      ["data"],
  liaisons_tableaux: ["contenu", "data"],
  liaisons_schema:   ["contenu", "data"],
  bureau_mails:      ["destinataires"],
  config_divisions:  ["roles", "lead", "colead"],
  config_acces:      ["roles"],
  config_journal:    ["avant", "apres"],
  pa_sessions:       ["questions"],
  pa_candidatures:   ["reponses"]
};

const echapper = id => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new Error(`Identifiant refuse : ${id}`);
  return `"${id}"`;
};

// PostgREST accepte les valeurs entre guillemets, et le chemin est encode.
function valeur(brut) {
  let v = decodeURIComponent(String(brut));
  if (v.length > 1 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
  return v;
}

/* ── analyse du select ─────────────────────────────────────────────── */
// « id,nom,agents(id,nom) » ou « referent:referent_id(id,nom) ».
// On decoupe au premier niveau seulement : il n'y a pas d'imbrication.
function decouperSelect(txt) {
  const morceaux = [];
  let profondeur = 0, courant = "";
  for (const c of txt) {
    if (c === "(") profondeur++;
    if (c === ")") profondeur--;
    if (c === "," && profondeur === 0) { morceaux.push(courant); courant = ""; continue; }
    courant += c;
  }
  if (courant) morceaux.push(courant);
  return morceaux.map(x => x.trim()).filter(Boolean);
}

function analyserSelect(table, txt) {
  const colonnes = [], jointures = [];
  if (!txt || txt === "*") return { colonnes: ["*"], jointures };
  for (const m of decouperSelect(txt)) {
    const par = m.indexOf("(");
    if (par === -1) { colonnes.push(m); continue; }

    const tete = m.slice(0, par);
    const champs = m.slice(par + 1, m.lastIndexOf(")"));
    const [alias, source] = tete.indexOf(":") !== -1 ? tete.split(":") : [tete, tete];
    const rel = RELATIONS[`${table}:${source}`];
    if (!rel) throw new Error(`Jointure inconnue : ${table} vers ${source}`);
    jointures.push({ alias, colonne: rel.colonne, cible: rel.cible,
      champs: decouperSelect(champs) });
    // La colonne portant la cle etrangere doit etre lue pour resoudre.
    if (colonnes.indexOf(rel.colonne) === -1) colonnes.push(rel.colonne);
  }
  return { colonnes, jointures };
}

/* ── analyse des filtres ───────────────────────────────────────────── */
function analyserFiltre(colonne, brut) {
  const txt = String(brut);
  const point = txt.indexOf(".");
  if (point === -1) throw new Error(`Filtre sans operateur : ${colonne}=${txt}`);
  let op = txt.slice(0, point), reste = txt.slice(point + 1);

  let nie = false;
  if (op === "not") {
    nie = true;
    const p2 = reste.indexOf(".");
    if (p2 === -1) throw new Error(`Filtre not incomplet : ${colonne}=${txt}`);
    op = reste.slice(0, p2); reste = reste.slice(p2 + 1);
  }

  const col = echapper(colonne);
  switch (op) {
    case "eq":  return { sql: `${col} ${nie ? "IS NOT" : "IS"} ?`, params: [valeur(reste)] };
    case "neq": return { sql: `${col} ${nie ? "IS" : "IS NOT"} ?`, params: [valeur(reste)] };
    case "gt":  return { sql: `${col} ${nie ? "<=" : ">"} ?`,  params: [valeur(reste)] };
    case "gte": return { sql: `${col} ${nie ? "<" : ">="} ?`,  params: [valeur(reste)] };
    case "lt":  return { sql: `${col} ${nie ? ">=" : "<"} ?`,  params: [valeur(reste)] };
    case "lte": return { sql: `${col} ${nie ? ">" : "<="} ?`,  params: [valeur(reste)] };
    case "like":
    case "ilike": {
      const v = valeur(reste).replace(/\*/g, "%");
      return { sql: `${col} ${nie ? "NOT LIKE" : "LIKE"} ?`, params: [v] };
    }
    case "is": {
      const v = valeur(reste).toLowerCase();
      if (v === "null")  return { sql: `${col} IS ${nie ? "NOT " : ""}NULL`, params: [] };
      if (v === "true")  return { sql: `${col} ${nie ? "IS NOT" : "IS"} 1`,  params: [] };
      if (v === "false") return { sql: `${col} ${nie ? "IS NOT" : "IS"} 0`,  params: [] };
      throw new Error(`is.${v} non gere`);
    }
    case "in": {
      const dedans = valeur(reste).replace(/^\(|\)$/g, "");
      const items = dedans ? dedans.split(",").map(x => valeur(x.trim())) : [];
      if (!items.length) return { sql: nie ? "1=1" : "1=0", params: [] };
      return { sql: `${col} ${nie ? "NOT IN" : "IN"} (${items.map(() => "?").join(",")})`,
        params: items };
    }
    case "ov": {
      // Chevauchement de tableaux. En SQLite la colonne est du JSON :
      // la ligne correspond si l'un des elements cherches y figure.
      const dedans = valeur(reste).replace(/^\{|\}$/g, "");
      const items = dedans ? dedans.split(",").map(x => valeur(x.trim())) : [];
      if (!items.length) return { sql: nie ? "1=1" : "1=0", params: [] };
      const un = `EXISTS (SELECT 1 FROM json_each(${col}) WHERE json_each.value = ?)`;
      const tous = items.map(() => un).join(" OR ");
      return { sql: nie ? `NOT (${tous})` : `(${tous})`, params: items };
    }
    default:
      throw new Error(`Operateur PostgREST non gere : ${op}`);
  }
}

/* ── le chemin, decoupe ────────────────────────────────────────────── */
export function analyser(chemin) {
  const sansPente = chemin.replace(/^\//, "");
  const point = sansPente.indexOf("?");
  const table = point === -1 ? sansPente : sansPente.slice(0, point);
  echapper(table);

  const req = { table, colonnes: ["*"], jointures: [], ou: [], params: [],
    ordre: [], limite: null, onConflict: null };

  if (point === -1) return req;
  for (const paire of sansPente.slice(point + 1).split("&")) {
    if (!paire) continue;
    const eg = paire.indexOf("=");
    if (eg === -1) throw new Error(`Parametre sans valeur : ${paire}`);
    const cle = decodeURIComponent(paire.slice(0, eg));
    const val = paire.slice(eg + 1);

    if (cle === "select") {
      const a = analyserSelect(table, decodeURIComponent(val));
      req.colonnes = a.colonnes; req.jointures = a.jointures;
    } else if (cle === "order") {
      for (const o of decodeURIComponent(val).split(",")) {
        const bouts = o.split(".");
        const sens = bouts.indexOf("desc") !== -1 ? "DESC" : "ASC";
        // nullslast et nullsfirst sont acceptes mais sans effet : SQLite
        // place deja les NULL en premier en ASC, comme Postgres.
        req.ordre.push(`${echapper(bouts[0])} ${sens}`);
      }
    } else if (cle === "limit") {
      const n = parseInt(decodeURIComponent(val), 10);
      if (Number.isFinite(n)) req.limite = n;
    } else if (cle === "offset") {
      req.decalage = parseInt(decodeURIComponent(val), 10) || 0;
    } else if (cle === "on_conflict") {
      req.onConflict = decodeURIComponent(val).split(",").map(x => x.trim());
    } else {
      const f = analyserFiltre(cle, val);
      req.ou.push(f.sql); req.params.push(...f.params);
    }
  }
  return req;
}

/* ── execution ─────────────────────────────────────────────────────── */
const estJson = (table, col) => (COLONNES_JSON[table] || []).indexOf(col) !== -1;

function lire(table, ligne) {
  if (!ligne) return ligne;
  const cols = COLONNES_JSON[table] || [];
  if (!cols.length) return ligne;
  const sortie = Object.assign({}, ligne);
  for (const c of cols) {
    if (typeof sortie[c] !== "string") continue;
    try { sortie[c] = JSON.parse(sortie[c]); } catch (e) {}
  }
  return sortie;
}

function ecrire(table, valeurs) {
  const sortie = {};
  for (const [c, v] of Object.entries(valeurs)) {
    if (v !== null && typeof v === "object") sortie[c] = JSON.stringify(v);
    else if (typeof v === "boolean") sortie[c] = v ? 1 : 0;
    else if (estJson(table, c) && typeof v === "string") sortie[c] = v;
    else sortie[c] = v === undefined ? null : v;
  }
  return sortie;
}

const clauseOu = req => req.ou.length ? " WHERE " + req.ou.join(" AND ") : "";

// Les colonnes reellement presentes, pour ignorer sans bruit ce qu'un
// appel enverrait en trop. PostgREST, lui, refuserait ; mais refuser ici
// casserait des ecritures qui passaient hier.
const colonnesDe = (db, table) =>
  db.prepare(`PRAGMA table_info(${echapper(table)})`).all().map(c => c.name);

export function executer(db, methode, chemin, corps, options = {}) {
  const req = analyser(chemin);
  const retourne = options.prefer !== "return=minimal";

  if (methode === "GET") {
    const cols = req.colonnes.indexOf("*") !== -1
      ? "*" : req.colonnes.map(echapper).join(", ");
    let sql = `SELECT ${cols} FROM ${echapper(req.table)}${clauseOu(req)}`;
    if (req.ordre.length) sql += " ORDER BY " + req.ordre.join(", ");
    if (req.limite !== null) sql += ` LIMIT ${req.limite}`;
    if (req.decalage) sql += ` OFFSET ${req.decalage}`;

    let lignes = db.prepare(sql).all(...req.params).map(l => lire(req.table, l));

    // Les jointures se resolvent ligne a ligne. Sur un fichier local une
    // lecture coute quelques microsecondes : la simplicite vaut mieux
    // qu'un assemblage de colonnes prefixees.
    for (const j of req.jointures) {
      const champs = j.champs.indexOf("*") !== -1
        ? "*" : j.champs.map(echapper).join(", ");
      const prep = db.prepare(
        `SELECT ${champs} FROM ${echapper(j.cible)} WHERE "id" IS ? LIMIT 1`);
      for (const l of lignes) {
        const id = l[j.colonne];
        l[j.alias] = id == null ? null : (lire(j.cible, prep.get(id)) || null);
      }
    }
    return lignes;
  }

  if (methode === "POST") {
    const items = Array.isArray(corps) ? corps : [corps];
    if (!items.length) return retourne ? [] : null;
    const connues = colonnesDe(db, req.table);
    const crees = [];

    const passe = db.transaction(() => {
      for (const brut of items) {
        const v = ecrire(req.table, brut);
        const cols = Object.keys(v).filter(c => connues.indexOf(c) !== -1);
        const vals = cols.map(c => v[c]);
        let sql = `INSERT INTO ${echapper(req.table)} (${cols.map(echapper).join(", ")})`
          + ` VALUES (${cols.map(() => "?").join(", ")})`;
        if (req.onConflict) {
          // Prefer: resolution=merge-duplicates. Sans cible explicite,
          // l'insertion echouerait sur la contrainte au lieu de fusionner.
          const maj = cols.filter(c => req.onConflict.indexOf(c) === -1);
          sql += ` ON CONFLICT (${req.onConflict.map(echapper).join(", ")}) DO `
            + (maj.length
              ? `UPDATE SET ${maj.map(c => `${echapper(c)} = excluded.${echapper(c)}`).join(", ")}`
              : "NOTHING");
        }
        sql += " RETURNING *";
        const ligne = db.prepare(sql).get(...vals);
        if (ligne) crees.push(lire(req.table, ligne));
      }
    });
    passe();
    return retourne ? crees : null;
  }

  if (methode === "PATCH") {
    const connues = colonnesDe(db, req.table);
    const v = ecrire(req.table, corps || {});
    const cols = Object.keys(v).filter(c => connues.indexOf(c) !== -1);
    if (!cols.length) return retourne ? [] : null;
    const sql = `UPDATE ${echapper(req.table)} SET `
      + cols.map(c => `${echapper(c)} = ?`).join(", ")
      + clauseOu(req) + (retourne ? " RETURNING *" : "");
    const prep = db.prepare(sql);
    const args = [...cols.map(c => v[c]), ...req.params];
    if (!retourne) { prep.run(...args); return null; }
    return prep.all(...args).map(l => lire(req.table, l));
  }

  if (methode === "DELETE") {
    const sql = `DELETE FROM ${echapper(req.table)}${clauseOu(req)}`
      + (retourne ? " RETURNING *" : "");
    const prep = db.prepare(sql);
    if (!retourne) { prep.run(...req.params); return null; }
    return prep.all(...req.params).map(l => lire(req.table, l));
  }

  throw new Error(`Methode non geree : ${methode}`);
}
