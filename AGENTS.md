# Instructions pour tout agent travaillant sur ce depot

## D'abord

**Lire `CLAUDE.md` en entier avant de toucher au code.** Il porte
l'architecture, ce qu'elle interdit, les pieges qui ont deja coute cher
et les conventions d'ecriture. Ce fichier-ci ne le repete pas, il ajoute
la methode.

Pour le chantier en cours (bascule sur un VPS), lire aussi
`vps-reprise.md`, puis `vps-installation.md`.

**Perimetre : SASP SUD uniquement. Ne jamais toucher au SASP NORD.**

## La methode

**Verifier la conclusion, jamais l'apparence.** C'est la regle qui a
coute le plus cher ici.

- Un preflight CORS qui rend `204` ne prouve rien : lire
  `access-control-allow-headers`.
- Un `git push` reussi ne prouve pas que le deploiement a marche : lire
  la conclusion de l'action GitHub. Le Worker est reste fige pendant sept
  commits sans que rien ne le signale.
- Un fichier de configuration ne dit pas ce que le service applique :
  `sshd -T`, `nginx -t`, `systemctl status`.
- Un `grep` qui compte des octets se trompe sous Git Bash : compter avec
  Node.

**Prouver avant d'affirmer.** Ne pas ecrire qu'une chose fonctionne sans
l'avoir vue fonctionner. Si un essai n'a pas ete fait, le dire.

**Rejouer la logique modifiee contre les vraies donnees** avant de
pousser. C'est ce qui a permis de trouver que les liaisons de la saisie
rapide etaient perdues en silence, et que la table des droits d'AEGIS se
comportait bien dans ses onze cas.

**Avant tout push :**

```bash
node --check worker.js
node --check app.js
node --check db.js
```

Pour une page autonome, extraire son JS et le verifier :

```bash
node -e 'const fs=require("fs");const s=fs.readFileSync("sasp/liaisons/index.html","utf8");
const d=s.lastIndexOf("<script>"),f=s.lastIndexOf("</script>");
fs.writeFileSync("/tmp/v.js",s.slice(d+8,f),"utf8");'
node --check /tmp/v.js
```

Et verifier qu'aucun tiret cadratin n'a ete introduit :

```bash
git diff -U0 | grep '^+' | node -e 'let s="";process.stdin.on("data",d=>s+=d)
.on("end",()=>{let n=0;for(const c of s){const p=c.codePointAt(0);
if(p===0x2014||p===0x2013)n++}console.log(n?"TIRETS CADRATINS : "+n:"aucun")});'
```

**Modifier par script, pas a la main.** Les gros fichiers sont en CRLF et
les outils d'edition les ecrasent en LF, ce qui produit un diff de
milliers de lignes pour un changement d'une ligne. Ecrire un petit script
Node qui decoupe sur `/\r?\n/` et rejoint avec la fin de ligne d'origine.

Dans ce script, **toujours passer une fonction a `replace`** :
`s.replace(avant, () => apres)`. Sinon les `$$`, `$&` et `` $` `` du texte
de remplacement sont interpretes, ce qui a deja casse trois lignes de
JavaScript sans le moindre message.

**Verifier qu'un motif est unique avant de le remplacer.** Un remplacement
qui touche deux endroits au lieu d'un ne se voit pas.

## Le deploiement

**Un push sur `gh-pages` met le site et le Worker en production.** Il n'y
a pas de preproduction. Toujours `git pull --rebase origin gh-pages`
avant de pousser.

**Changer le `?v=` a chaque deploiement**, dans `index.html` et dans
`pa.html`, qui ont chacun le leur. Sinon les navigateurs servent l'ancien
code et le bug rapporte n'existe deja plus.

**Demander avant toute modification importante.** Consigne explicite de
Louis.

## L'ecriture

**Jamais de tiret cadratin** (U+2014) ni de demi-cadratin (U+2013).
Uniquement le tiret simple du clavier, ou deux-points, parentheses,
virgules. Vaut pour le code, les commentaires, les messages de commit,
l'interface et les annonces Discord.

Interface, commentaires et commits **en francais**.

Les commentaires expliquent **pourquoi**, pas quoi. Un commentaire qui
paraphrase la ligne suivante est du bruit.

Les messages de commit disent ce qui n'allait pas et pourquoi le
changement le corrige, pas la liste des fichiers touches.

## L'acces reseau

Le travail en cours suppose de joindre le VPS (`ssh sasp@193.38.250.69`),
GitHub et l'API Discord. **Un agent dont le bac a sable coupe le reseau
ne pourra rien faire de la bascule** : verifier ce point avant de
commencer, plutot que d'accumuler des echecs opaques.
