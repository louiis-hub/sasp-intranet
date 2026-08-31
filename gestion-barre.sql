-- La barre du bas, reglable depuis l'ecran de gestion
--
-- A executer A LA MAIN dans l'editeur SQL de Supabase, apres gestion.sql.
--
-- Jusqu'ici la barre etait ecrite en dur dans index.html : creer une
-- division depuis l'ecran de gestion ne la faisait pas apparaitre. Ces
-- deux colonnes decident de sa rubrique et du libelle affiche.

alter table config_divisions add column if not exists groupe text default 'Divisions';
alter table config_divisions add column if not exists court  text;

-- « groupe » nomme la rubrique de la barre. La valeur '-' retire
-- l'entree de la barre sans desactiver la division : elle reste
-- accessible par le dossier Divisions et par son adresse interne.
comment on column config_divisions.groupe is
  'Rubrique de la barre du bas : Academie, Divisions, Unites, ou - pour ne pas y figurer';
comment on column config_divisions.court is
  'Libelle affiche dans la barre. Vide = le nom complet.';

-- Reprise fidele de ce que la barre affiche aujourd'hui.
update config_divisions set groupe = 'Academie',  court = 'Salons PA'                where code = 'PA';
update config_divisions set groupe = 'Divisions', court = 'SWAT'                     where code = 'SWAT';
update config_divisions set groupe = 'Divisions', court = 'CID'                      where code = 'CID';
update config_divisions set groupe = 'Divisions', court = 'K9'                       where code = 'K9';
update config_divisions set groupe = 'Divisions', court = 'Fugitive T. Force'        where code = 'FTF';
update config_divisions set groupe = 'Divisions', court = 'Internal Affairs'         where code = 'IA';
update config_divisions set groupe = 'Divisions', court = 'Syndicat'                 where code = 'SYND';
update config_divisions set groupe = 'Unites',    court = 'Traffic Unit'             where code = 'TU';
update config_divisions set groupe = 'Unites',    court = 'Crisis & Negotiation Unit' where code = 'CNU';
update config_divisions set groupe = 'Unites',    court = 'Lincoln Patrol'           where code = 'LP';
