# Sortir de Supabase - brief

A coller a l'agent qui prend ce chantier. Il a PowerShell sur le PC de
Louis, donc SSH vers le VPS.

**Lire `AGENTS.md` puis `CLAUDE.md` avant de toucher au code.**
`vps-reprise.md` decrit l'etat de la machine et les acces.

**Perimetre : SASP SUD uniquement. Ne jamais toucher au SASP NORD.**

---

## Ou on en est

Le 31 aout 2026, tout a ete deplace de GitHub Pages et Cloudflare vers le
VPS : le site, l'API, le bot Discord et les taches periodiques. Le Worker
Cloudflare reste deploye mais sans declencheur et sans trafic, comme
filet.

**Supabase est le dernier hebergeur exterieur.** Il rend deux services
distincts, qui ne coutent pas la meme chose a reprendre.

## Les deux moities, a ne pas confondre

**1. La base. C'est un copier-coller.** Mesure sur le code, pas estime :

| Construction | Occurrences |
|---|---|
| `eq.` | 77 |
| `select=` | 58 |
| `limit=` | 50 |
| `order=` | 27 |
| `on_conflict` | 7 |
| `is.` | 6 |
| `not.` | 4 |
| `neq.` | 4 |
| `in.`, `gt.`, `ov.` | 1 chacun |
| `or=(`, `and=(`, `rpc/`, `offset=`, `range=` | **aucun** |

**117 appels** (`sb` 67, `sbForSite` 50) sur **23 tables**, et seulement
**deux formes de jointure**, toutes deux a un seul niveau.

**Consequence : ne pas toucher aux 117 appels.** Il suffit de reecrire
`sb()` / `sbForSite()` pour traduire cette poignee de constructions en
SQL. C'est la meme methode qui a permis de faire tourner `worker.js` tel
quel sur Node.

**2. L'authentification. C'est une vraie reecriture.** Le navigateur
detient un jeton Supabase, l'envoie a chaque appel, le serveur le valide
aupres de `/auth/v1/user` puis relit les roles Discord. Le remplacer veut
dire que le serveur mene lui-meme l'echange OAuth avec Discord et pose un
cookie `httpOnly`, `secure`, `sameSite=lax`. Ca touche le front des trois
applications et la moitie haute de `worker.js`.

**Ne faire QUE la moitie 1. L'authentification ne t'appartient pas.**

Un autre chantier, mene en parallele, porte le site sur Next.js. Sa
deuxieme etape deplace la session dans un cookie pour rendre les pages
reellement protegeables : elle reecrit donc l'authentification, des deux
cotes. Deux reecritures simultanees de la meme couche produiraient un
conflit qu'on mettrait des heures a demeler.

Concretement : ne pas toucher a `/auth/v1/user`, ni a `bureauIdentifier`,
ni a `liaisonsIdentifier`, ni a `signInWithOAuth` dans `db.js` et
`index.html`. La base seule.

## Ce qu'il faut ecrire

### a. Le schema SQLite

**Ne pas le deviner depuis le code.** Deviner un schema, c'est se
garantir une migration qui perd des colonnes en silence. Le relever chez
Supabase, dans le SQL Editor :

```sql
select table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

```sql
select tc.table_name, tc.constraint_type, kcu.column_name,
       ccu.table_name as cible, ccu.column_name as cible_colonne
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
left join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
where tc.table_schema = 'public'
order by tc.table_name, tc.constraint_type;
```

Correspondances qui comptent :

| Postgres | SQLite | Attention |
|---|---|---|
| `bigserial` / `serial` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `timestamptz` | `TEXT` en ISO 8601 UTC | le code compare des chaines et fait `new Date(...)` |
| `jsonb` | `TEXT` | serialiser et deserialiser dans la couche, pas dans les 117 appels |
| `text[]` | `TEXT` (JSON) | c'est le cas de `destinataires`, vise par le seul `ov.` |
| `boolean` | `INTEGER` 0/1 | le code teste la verite JavaScript, verifier chaque usage |

### b. La couche d'acces

Remplacer le corps de `sbForSite`. La signature ne change pas :

```js
async function sbForSite(env, method, path, body, siteKey = "sud")
```

Elle recoit un chemin PostgREST (`/agents?select=id,nom&discord_id=eq.123&limit=1`)
et doit rendre exactement ce que rendait Supabase :

- un **tableau** de lignes en `GET` ;
- les lignes creees en `POST` (`Prefer: return=representation`) ;
- `null` sur un 204 ;
- une **exception** en cas d'erreur, avec le message en JSON.

A couvrir, et rien de plus : `eq neq gt is not in ov`, `select` avec les
deux formes de jointure, `order`, `limit`, `on_conflict`, et le
comptage utilise une seule fois.

**Les deux jointures**, toutes deux a un niveau :

```
select=id,agent_id,clock_in,...,agents(id,nom,prenom,matricule,discord_id)
select=id,nom,prenom,matricule,grade,statut,referent_id,referent:referent_id(id,nom,prenom,matricule,grade)
```

La premiere depuis `pointages`, la seconde depuis `agents` vers
elle-meme. La forme `alias:colonne(champs)` doit rendre un objet imbrique
sous le nom de l'alias.

**Utiliser `better-sqlite3`**, qui est synchrone : sur un fichier local
une lecture prend quelques microsecondes, et le code en devient nettement
plus lisible.

**Le NORD doit continuer a passer par Supabase.** `getSupabaseConfigForSite`
renvoie une configuration differente selon `siteKey`. Seul `"sud"` bascule
sur SQLite ; `"nord"` garde l'appel HTTP tel quel.

### c. Le script de reprise

Il lit Supabase avec la cle service et remplit SQLite. **Rejouable
autant de fois qu'on veut**, une transaction par table :

```js
// Soit tout passe, soit rien : une table a moitie reprise est pire
// qu'une table vide, parce qu'elle a l'air correcte.
const inserer = db.transaction(lignes => { for (const l of lignes) stmt.run(l); });
```

PostgREST plafonne a 1000 lignes par requete : paginer avec
`?limit=1000&offset=N` et boucler.

## Les regles de securite

**Ne jamais ecrire dans Supabase pendant la reprise.** Le site tourne et
des agents s'en servent : une reprise qui ecrit des deux cotes produit
des divergences invisibles.

**Comparer les comptes de lignes, table par table, apres chaque reprise.**
Un ecart d'une ligne est un bug, pas un arrondi.

**Faire tourner les deux en parallele avant de basculer.** SQLite se
remplit, Supabase reste la reference, on compare. C'est la seule facon de
trouver les ecarts avant qu'ils coutent.

**Sauvegarder avant de basculer, et savoir restaurer.** Toute la base
sera un seul fichier :

```bash
sqlite3 /var/sasp/sasp.db ".backup '/var/sauvegardes/sasp-$(date +%F-%H%M).db'"
```

Jamais un `cp` sur une base ouverte : on obtient une base corrompue sans
le savoir. Une copie quotidienne **hors du VPS**. Une sauvegarde jamais
restauree n'est pas une sauvegarde, c'est une intention.

## Les pieges du depot

Ils sont dans `AGENTS.md` et `CLAUDE.md`. Les trois qui mordront ici :

**Les fins de ligne.** `worker.js` est en CRLF. Ecrire en LF produit un
diff de milliers de lignes pour un changement d'une ligne. Decouper sur
`/\r?\n/`, rejoindre avec la fin de ligne d'origine.

**`String.replace` mange les `$$`.** Toujours passer une fonction :
`s.replace(avant, () => apres)`.

**Verifier la conclusion, pas l'apparence.** Un `git push` reussi ne
prouve pas que le deploiement a marche. Un `select` qui rend des lignes
ne prouve pas qu'il rend les **memes** lignes.

## Le deroule

1. Relever le schema chez Supabase, avec les deux requetes ci-dessus.
2. Ecrire `vps/schema.sql` et creer la base vide.
3. Ecrire `vps/reprise-supabase.js`, le jouer, comparer les comptes.
4. Ecrire la nouvelle couche d'acces, **derriere un interrupteur**
   (`BASE=sqlite` ou `BASE=supabase` dans `/etc/sasp/api.env`), pour
   pouvoir revenir en une seconde.
5. Jouer les deux en parallele quelques jours, comparer.
6. Basculer, garder Supabase intact un mois.

**Ne pas viser la bascule en une soiree.** Et ne pas commencer
l'authentification tant que la base n'est pas stable : deux migrations
en meme temps rendent la premiere panne inattribuable.

## A ne pas faire

- Toucher au SASP NORD.
- Reecrire les 117 appels : c'est `sb()` qu'on remplace.
- Toucher a l'authentification : elle appartient au chantier Next.js.
- Supprimer quoi que ce soit dans Supabase avant un mois de
  fonctionnement de SQLite.
- Employer un tiret cadratin, nulle part.
