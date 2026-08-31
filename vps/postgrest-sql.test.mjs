// Essais du traducteur, contre une vraie base SQLite en memoire.
//
// A lancer depuis vps/ : node postgrest-sql.test.mjs
//
// Les cas ne sont pas inventes : ils reprennent les formes que worker.js
// produit reellement, jointures et upserts compris.
import Database from "better-sqlite3";
import { analyser, executer } from "./postgrest-sql.mjs";

let reussis = 0, echecs = 0;
const verifier = (nom, obtenu, attendu) => {
  const a = JSON.stringify(attendu), b = JSON.stringify(obtenu);
  if (a === b) { reussis++; return; }
  echecs++;
  console.log(`  ECHEC  ${nom}\n         attendu ${a}\n         obtenu  ${b}`);
};
const leve = (nom, fn) => {
  try { fn(); echecs++; console.log(`  ECHEC  ${nom} : aucune erreur levee`); }
  catch (e) { reussis++; }
};

const db = new Database(":memory:");
db.exec(`
  create table agents (
    id integer primary key, matricule text, nom text, prenom text,
    grade text, statut text, telephone text, discord_id text, referent_id integer
  );
  create table pointages (
    id integer primary key, agent_id integer, clock_in text, clock_out text,
    discord_id text
  );
  create table bureau_mails (
    id integer primary key, sujet text, destinataires text, lu integer default 0
  );
  create table liaisons_acces (
    discord_id text primary key, nom text, ajoute_par text
  );
  create table config_acces (
    cle text primary key, libelle text, roles text
  );
`);

db.exec(`
  insert into agents (id,matricule,nom,prenom,grade,statut,discord_id,referent_id) values
    (1,'01','Taishiro','Sinichi','Trooper I','Actif','541007733294366720',null),
    (2,'02','Mcween','Billy','Rookie','Actif','411951756088442890',1),
    (3,'03','Reed','William','Captain','Licencié','111111111111111111',1);
  insert into pointages (id,agent_id,clock_in,clock_out,discord_id) values
    (1,1,'2026-08-31T08:00:00Z',null,'541007733294366720'),
    (2,2,'2026-08-30T08:00:00Z','2026-08-30T16:00:00Z','411951756088442890');
  insert into bureau_mails (id,sujet,destinataires) values
    (1,'Note de service','["swat@sasp.com","cid@sasp.com"]'),
    (2,'Convocation','["leoarras@sasp.com"]');
`);

console.log("── analyse ──");
verifier("table seule", analyser("/agents").table, "agents");
verifier("colonnes", analyser("/agents?select=id,nom").colonnes, ["id", "nom"]);
verifier("ordre desc", analyser("/agents?order=matricule.desc").ordre, ['"matricule" DESC']);
verifier("limite", analyser("/agents?limit=5").limite, 5);
verifier("on_conflict", analyser("/config_acces?on_conflict=cle").onConflict, ["cle"]);
verifier("jointure simple",
  analyser("/pointages?select=id,agents(nom,prenom)").jointures[0].cible, "agents");
verifier("jointure aliasee",
  analyser("/agents?select=id,referent:referent_id(nom)").jointures[0].alias, "referent");

console.log("\n── selection ──");
verifier("tout", executer(db, "GET", "/agents?select=id&order=id").map(a => a.id), [1, 2, 3]);
verifier("eq",
  executer(db, "GET", "/agents?matricule=eq.02&select=nom").map(a => a.nom), ["Mcween"]);
verifier("eq encode",
  executer(db, "GET", "/agents?statut=eq.Licenci%C3%A9&select=nom").map(a => a.nom), ["Reed"]);
verifier("neq encode",
  executer(db, "GET", "/agents?statut=neq.Licenci%C3%A9&select=id&order=id").map(a => a.id), [1, 2]);
verifier("is null",
  executer(db, "GET", "/pointages?clock_out=is.null&select=id").map(p => p.id), [1]);
verifier("not is null",
  executer(db, "GET", "/agents?referent_id=not.is.null&select=id&order=id").map(a => a.id), [2, 3]);
verifier("in",
  executer(db, "GET", "/agents?matricule=in.(01,03)&select=id&order=id").map(a => a.id), [1, 3]);
verifier("not in",
  executer(db, "GET", "/agents?statut=not.in.(Licenci%C3%A9)&select=id&order=id").map(a => a.id), [1, 2]);
// Le filtre exact que worker.js applique partout, ACTIVE_AGENTS_FILTER.
verifier("filtre des agents actifs",
  executer(db, "GET", "/agents?select=id&statut=not.in.(Licenci%C3%A9,Retrait%C3%A9,D%C3%A9mission)&order=id")
    .map(a => a.id), [1, 2]);
verifier("gt", executer(db, "GET", "/agents?id=gt.2&select=id").map(a => a.id), [3]);
verifier("limite", executer(db, "GET", "/agents?select=id&order=id&limit=2").length, 2);
verifier("ordre desc",
  executer(db, "GET", "/agents?select=id&order=id.desc").map(a => a.id), [3, 2, 1]);
verifier("deux filtres",
  executer(db, "GET", "/agents?statut=eq.Actif&referent_id=eq.1&select=id").map(a => a.id), [2]);

console.log("\n── tableaux et json ──");
verifier("ov trouve",
  executer(db, "GET", '/bureau_mails?destinataires=ov.{"cid@sasp.com"}&select=id').map(m => m.id), [1]);
verifier("ov absent",
  executer(db, "GET", '/bureau_mails?destinataires=ov.{"rh@sasp.com"}&select=id').length, 0);
verifier("ov plusieurs",
  executer(db, "GET",
    '/bureau_mails?destinataires=ov.{"rh@sasp.com","leoarras@sasp.com"}&select=id').map(m => m.id), [2]);
verifier("json relu en tableau",
  executer(db, "GET", "/bureau_mails?id=eq.1&select=*")[0].destinataires,
  ["swat@sasp.com", "cid@sasp.com"]);

console.log("\n── jointures ──");
const pj = executer(db, "GET",
  "/pointages?select=id,agent_id,clock_in,agents(id,nom,prenom)&clock_out=is.null");
verifier("jointure remplie", pj[0].agents, { id: 1, nom: "Taishiro", prenom: "Sinichi" });
const aj = executer(db, "GET",
  "/agents?select=id,nom,referent_id,referent:referent_id(id,nom)&order=id");
verifier("jointure aliasee", aj[1].referent, { id: 1, nom: "Taishiro" });
verifier("jointure nulle", aj[0].referent, null);

console.log("\n── booleens ──");
// Postgres a un vrai booleen, SQLite garde 0 ou 1. Sans conversion,
// config_divisions?actif=eq.true rendait zero ligne SANS RIEN DIRE, et
// la configuration des divisions retombait sur le repli en silence.
db.exec(`create table config_divisions (
  code text primary key, nom text, actif integer, ordre integer);
  insert into config_divisions values
    ('SWAT','Special Weapons',1,30), ('OLD','Ancienne',0,99);`);
verifier("eq.true trouve les actives",
  executer(db, "GET", "/config_divisions?select=code&actif=eq.true&order=ordre")
    .map(d => d.code), ["SWAT"]);
verifier("eq.false trouve les inactives",
  executer(db, "GET", "/config_divisions?select=code&actif=eq.false").map(d => d.code), ["OLD"]);
verifier("is.true aussi",
  executer(db, "GET", "/config_divisions?select=code&actif=is.true").map(d => d.code), ["SWAT"]);
verifier("not.is.true",
  executer(db, "GET", "/config_divisions?select=code&actif=not.is.true").map(d => d.code), ["OLD"]);
verifier("booleen ecrit en 1",
  executer(db, "POST", "/config_divisions",
    { code: "NEW", nom: "Neuve", actif: true, ordre: 5 })[0].actif, 1);

console.log("\n── ecriture ──");
verifier("insertion rendue",
  executer(db, "POST", "/liaisons_acces",
    { discord_id: "123", nom: "Essai", ajoute_par: "Test" })[0].nom, "Essai");
verifier("upsert cree",
  executer(db, "POST", "/config_acces?on_conflict=cle",
    { cle: "poste", libelle: "Poste", roles: ["1", "2"] })[0].roles, ["1", "2"]);
verifier("upsert fusionne",
  executer(db, "POST", "/config_acces?on_conflict=cle",
    { cle: "poste", libelle: "Poste", roles: ["9"] })[0].roles, ["9"]);
verifier("une seule ligne apres upsert",
  executer(db, "GET", "/config_acces?select=cle").length, 1);
verifier("patch",
  executer(db, "PATCH", "/agents?id=eq.2", { grade: "Trooper II" })[0].grade, "Trooper II");
verifier("patch minimal",
  executer(db, "PATCH", "/agents?id=eq.2", { grade: "Trooper III" },
    { prefer: "return=minimal" }), null);
verifier("patch applique",
  executer(db, "GET", "/agents?id=eq.2&select=grade")[0].grade, "Trooper III");
verifier("suppression",
  executer(db, "DELETE", "/liaisons_acces?discord_id=eq.123").length, 1);
verifier("suppression effective",
  executer(db, "GET", "/liaisons_acces?select=discord_id").length, 0);
verifier("colonne inconnue ignoree",
  executer(db, "POST", "/liaisons_acces",
    { discord_id: "456", nom: "X", colonne_qui_n_existe_pas: 1 })[0].nom, "X");

console.log("\n── ce qui doit echouer bruyamment ──");
leve("operateur inconnu", () => executer(db, "GET", "/agents?nom=cs.{a}"));
leve("jointure inconnue", () => executer(db, "GET", "/agents?select=id,pointages(id)"));
leve("table injectee", () => executer(db, "GET", '/agents";drop table agents;--?select=id'));
leve("colonne injectee", () => executer(db, "GET", '/agents?select=id&nom";--=eq.x'));
leve("or non gere", () => executer(db, "GET", "/agents?or=(id.eq.1,id.eq.2)"));

console.log(`\n${reussis} reussis, ${echecs} echec(s)`);
process.exit(echecs ? 1 : 0);
