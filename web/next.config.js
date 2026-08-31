/** @type {import('next').NextConfig} */
module.exports = {
  // Sans ceci, Next redirige « /sasp/liaisons/ » vers « /sasp/liaisons »
  // AVANT les reecritures. La barre finale disparait, et tous les chemins
  // relatifs de la page se resolvent alors un cran trop haut.
  skipTrailingSlashRedirect: true,

  // Les pages actuelles vivent dans public/ et sont servies telles quelles.
  // Next ne resout pas l'index d'un dossier de public/ : sans ces
  // reecritures, « / » et « /sasp/liaisons/ » rendraient 404.
  // beforeFiles les applique avant la resolution des fichiers.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/',                 destination: '/index.html' },
        { source: '/sasp/liaisons',    destination: '/sasp/liaisons/index.html' },
        { source: '/sasp/liaisons/',   destination: '/sasp/liaisons/index.html' }
      ]
    };
  },

  // index.html et pa.html portent le ?v= des autres fichiers : les mettre
  // en cache reviendrait a figer tout le reste.
  async headers() {
    // La regle porte sur le chemin DEMANDE, pas sur la cible de la
    // reecriture : « / » doit donc y figurer en plus de « /index.html ».
    const sansCache = [{ key: 'Cache-Control', value: 'no-store' }];
    return [
      { source: '/',           headers: sansCache },
      { source: '/index.html', headers: sansCache },
      { source: '/pa.html',    headers: sansCache }
    ];
  }

  // A ajouter quand SQLite arrivera, sinon la compilation echoue :
  //   serverExternalPackages: ['better-sqlite3']
};
