// Adaptateur Node pour worker.js
//
// Le Worker n'utilise aucune interface propre a Cloudflare : ni KV, ni D1,
// ni le cache. Il ne se sert que de fetch, Request, Response et
// crypto.subtle, que Node 22 fournit tous. Le fichier tourne donc tel quel
// et ce module se contente de traduire les entrees et les sorties, plus de
// rejouer les deux crons de wrangler.toml.
import { createServer } from 'node:http';
import worker from './worker.js';

const PORT = Number(process.env.PORT || 8787);
const HOTE = process.env.HOTE || '127.0.0.1';   // nginx est devant

// waitUntil sert au Worker a prolonger une tache apres la reponse. Sur Node
// le processus ne meurt pas apres la requete : il suffit de ne pas perdre
// l'erreur si la tache echoue.
const ctx = {
  waitUntil: p => Promise.resolve(p).catch(e => console.error('[waitUntil]', e)),
  passThroughOnException() {}
};

// Les en-tetes de saut a saut n'ont pas de sens pour fetch, et undici les
// refuse. On les enleve plutot que de laisser la requete echouer.
const HORS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'host', 'content-length']);

function enTetes(h) {
  const o = {};
  for (const [k, v] of Object.entries(h)) {
    if (HORS.has(k.toLowerCase()) || v === undefined) continue;
    o[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return o;
}

const lireCorps = req => new Promise((ok, ko) => {
  const m = [];
  req.on('data', c => m.push(c));
  req.on('end', () => ok(Buffer.concat(m)));
  req.on('error', ko);
});

const serveur = createServer(async (req, res) => {
  const debut = Date.now();
  try {
    const hote = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    // nginx pose x-forwarded-proto. Sans lui l'URL vue par le Worker serait
    // en http, et les adresses absolues qu'il construit sortiraient en clair.
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const sansCorps = req.method === 'GET' || req.method === 'HEAD';
    const corps = sansCorps ? null : await lireCorps(req);

    const requete = new Request(`${proto}://${hote}${req.url}`, {
      method: req.method,
      headers: enTetes(req.headers),
      body: corps && corps.length ? corps : undefined
    });

    const reponse = await worker.fetch(requete, process.env, ctx);

    const sortie = {};
    reponse.headers.forEach((v, k) => { if (k.toLowerCase() !== 'set-cookie') sortie[k] = v; });
    const biscuits = reponse.headers.getSetCookie ? reponse.headers.getSetCookie() : [];
    if (biscuits.length) sortie['set-cookie'] = biscuits;

    const buffer = Buffer.from(await reponse.arrayBuffer());
    res.writeHead(reponse.status, sortie);
    res.end(buffer);
    journal(req, reponse.status, Date.now() - debut);
  } catch (e) {
    console.error('[erreur]', req.method, req.url, e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Erreur serveur.' }));
    journal(req, 500, Date.now() - debut);
  }
});

// La sante et les preflights passent des dizaines de fois par minute : les
// journaliser noierait tout le reste.
function journal(req, code, ms) {
  if (req.url === '/health' || req.method === 'OPTIONS') return;
  console.log(`${req.method} ${req.url} ${code} ${ms}ms`);
}

/* ── les crons de wrangler.toml ──────────────────────────────────
   ILS NE PARTENT QUE SI CRONS=1.

   Pendant toute la bascule, le Worker Cloudflare tourne encore et lance
   deja ces memes taches. Or celle des 15 minutes n'est pas contemplative :
   elle envoie des messages prives, edite le message de la pointeuse,
   ecrit les roles dans Supabase, publie un rapport de synchronisation et
   renomme des membres sur un second serveur. La faire partir des deux
   cotes, c'est doubler tout cela.

   On ne bascule CRONS a 1 qu'a l'etape 6, quand Cloudflare est eteint.────
   Cloudflare les declenche en UTC. On garde la meme reference, sinon la
   ceremonie du dimanche 18 h partirait a la mauvaise heure une partie de
   l'annee, au gre de l'heure d'ete. */
const CRONS = [
  { motif: '*/15 * * * *', quand: d => d.getUTCMinutes() % 15 === 0 },
  { motif: '0 18 * * SUN', quand: d => d.getUTCDay() === 0 && d.getUTCHours() === 18 && d.getUTCMinutes() === 0 }
];

// Au demarrage on marque la minute courante comme deja traitee : sinon un
// redemarrage tombant sur une minute ronde rejouerait le cron aussitot, et
// un redemarrage en boucle le rejouerait en boucle.
let derniereMinute = new Date().toISOString().slice(0, 16);
const CRONS_ACTIFS = process.env.CRONS === '1';

async function declencher(motif) {
  try {
    await worker.scheduled({ cron: motif, scheduledTime: Date.now() }, process.env, ctx);
    console.log('[cron]', motif, 'termine');
  } catch (e) {
    console.error('[cron]', motif, e);
  }
}

if (CRONS_ACTIFS) {
  setInterval(() => {
    const d = new Date();
    const cle = d.toISOString().slice(0, 16);
    if (cle === derniereMinute) return;      // une seule passe par minute
    derniereMinute = cle;
    CRONS.forEach(c => { if (c.quand(d)) declencher(c.motif); });
  }, 20000);
}

serveur.listen(PORT, HOTE, () => {
  console.log(`[sasp] API en ecoute sur ${HOTE}:${PORT}`);
  console.log(CRONS_ACTIFS
    ? '[sasp] crons : ACTIFS - verifier que Cloudflare ne les lance plus'
    : '[sasp] crons : en veille (CRONS != 1) - Cloudflare les porte encore');
  const manquants = ['DISCORD_BOT_TOKEN', 'SUPABASE_SERVICE_KEY', 'DISCORD_PUBLIC_KEY']
    .filter(k => !process.env[k]);
  if (manquants.length) console.warn('[sasp] variables manquantes :', manquants.join(', '));
});

// systemd envoie SIGTERM : on ferme proprement plutot que de couper des
// requetes en cours.
for (const s of ['SIGTERM', 'SIGINT']) {
  process.on(s, () => { console.log('[sasp] arret'); serveur.close(() => process.exit(0)); });
}
