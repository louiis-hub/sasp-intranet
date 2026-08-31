// La premiere page React du projet. Elle ne sert a rien d'autre qu'a
// prouver que la chaine tient : nginx, Next, le rendu serveur, et l'API
// qui repond depuis le meme nom.
//
// Elle est rendue a chaque appel, sans cache : une page d'etat mise en
// cache dirait l'etat d'hier.
export const dynamic = 'force-dynamic';

const API = process.env.SASP_API ?? 'http://127.0.0.1:8787';

async function sonderApi() {
  const debut = Date.now();
  try {
    const r = await fetch(`${API}/health`, { cache: 'no-store',
      signal: AbortSignal.timeout(4000) });
    return { ok: r.ok, code: r.status, ms: Date.now() - debut };
  } catch (e) {
    return { ok: false, code: 0, ms: Date.now() - debut,
      erreur: e instanceof Error ? e.message : String(e) };
  }
}

export default async function Etat() {
  const api = await sonderApi();
  const lignes: [string, string, boolean][] = [
    ['Next.js', 'rendu serveur actif', true],
    ['API', api.ok ? `en vie, ${api.ms} ms` : `injoignable (${api.erreur ?? api.code})`, api.ok],
    ['Node', process.version, true],
    ['Heure serveur', new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }), true]
  ];

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: '56px 24px' }}>
      <h1 style={{ fontSize: 26, margin: '0 0 6px' }}>Etat du poste</h1>
      <p style={{ color: '#8FA3C0', fontSize: 14, margin: '0 0 28px' }}>
        Page rendue par Next.js. Les autres pages du site sont servies telles
        quelles, sans React, le temps de les porter une par une.
      </p>

      <div style={{ border: '1px solid #1E2A40', borderRadius: 12, overflow: 'hidden' }}>
        {lignes.map(([nom, valeur, bon], i) => (
          <div key={nom} style={{ display: 'flex', alignItems: 'center', gap: 12,
            padding: '13px 16px', fontSize: 14,
            borderTop: i ? '1px solid #1E2A40' : undefined }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none',
              background: bon ? '#34D399' : '#F87171' }} />
            <b style={{ flex: 1, fontWeight: 500 }}>{nom}</b>
            <span style={{ color: '#8FA3C0', fontFamily: 'ui-monospace, monospace',
              fontSize: 13 }}>{valeur}</span>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 28 }}>
        <a href="/" style={{ color: '#60A5FA', fontSize: 14 }}>Retour au poste de travail</a>
      </p>
    </main>
  );
}
