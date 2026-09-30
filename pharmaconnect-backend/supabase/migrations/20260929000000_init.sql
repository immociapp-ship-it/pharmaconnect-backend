-- =====================================================================
-- PharmaConnect — Schéma de base de données (PostgreSQL / Supabase)
-- Cahier des charges V1.2 — Pharmacie du Terminus 40
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
create type role_type as enum ('vendeur', 'gestionnaire', 'administrateur');
create type statut_demande as enum ('en_attente', 'disponible', 'notifie', 'retire', 'annule', 'expire');
create type canal_notification as enum ('whatsapp', 'sms');
create type statut_notification as enum ('en_cours', 'envoye', 'delivre', 'lu', 'echec');

-- ---------------------------------------------------------------------
-- profils — un profil métier par compte Supabase Auth
-- ---------------------------------------------------------------------
create table profils (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  nom          text not null,
  role         role_type not null default 'vendeur',
  actif        boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Fonction utilitaire : rôle de l'utilisateur courant (évite de répéter la sous-requête dans chaque policy)
create function current_role_type() returns role_type
language sql stable security definer as $$
  select role from profils where user_id = auth.uid() and actif limit 1;
$$;

-- ---------------------------------------------------------------------
-- produits — référentiel
-- ---------------------------------------------------------------------
create table produits (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  dci        text,
  en_stock   boolean not null default false,
  maj_le     timestamptz not null default now(),
  maj_par    uuid references profils(id)
);
create index idx_produits_nom on produits using gin (to_tsvector('french', nom));

-- ---------------------------------------------------------------------
-- demandes — cœur du système
-- ---------------------------------------------------------------------
create table demandes (
  id                uuid primary key default gen_random_uuid(),
  produit_id        uuid not null references produits(id),
  client_prenom     text not null,
  client_telephone  text not null,
  quantite          int not null default 1 check (quantite > 0),
  statut            statut_demande not null default 'en_attente',
  consentement      boolean not null default false,
  consentement_le   timestamptz,
  vendeur_id        uuid not null references profils(id),
  reserve_le        timestamptz,        -- réponse "Réserver" du client, alerte à valider par le vendeur
  retire_le         timestamptz,
  created_at        timestamptz not null default now(),
  constraint chk_consentement check (consentement = true)  -- pas de demande sans consentement
);
create index idx_demandes_statut on demandes(statut);
create index idx_demandes_produit on demandes(produit_id) where statut = 'en_attente';

-- ---------------------------------------------------------------------
-- notifications — historique d'envoi WhatsApp / SMS
-- ---------------------------------------------------------------------
create table notifications (
  id               uuid primary key default gen_random_uuid(),
  demande_id       uuid not null references demandes(id) on delete cascade,
  canal            canal_notification not null,
  statut           statut_notification not null default 'en_cours',
  tentative        int not null default 1,
  reponse_client   text,               -- 'reserver' / 'plus_tard' / null
  envoye_le        timestamptz not null default now(),
  maj_le           timestamptz not null default now()
);
create index idx_notifications_demande on notifications(demande_id);

-- ---------------------------------------------------------------------
-- imports_stock — traçabilité des imports CSV/Excel
-- ---------------------------------------------------------------------
create table imports_stock (
  id                     uuid primary key default gen_random_uuid(),
  fichier_nom            text not null,
  gestionnaire_id        uuid not null references profils(id),
  lignes_reconnues       int not null default 0,
  demandes_rapprochees   int not null default 0,
  created_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- journal_audit — toutes les actions sensibles (rôles, statuts, imports)
-- ---------------------------------------------------------------------
create table journal_audit (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references profils(id),
  action       text not null,
  cible_type   text not null,
  cible_id     uuid,
  details      jsonb,
  created_at   timestamptz not null default now()
);
create index idx_audit_cible on journal_audit(cible_type, cible_id);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table profils        enable row level security;
alter table produits       enable row level security;
alter table demandes       enable row level security;
alter table notifications  enable row level security;
alter table imports_stock  enable row level security;
alter table journal_audit  enable row level security;

-- ---- profils : chacun voit son profil ; l'administrateur voit et modifie tout
create policy profils_self_select on profils
  for select using (user_id = auth.uid() or current_role_type() = 'administrateur');

create policy profils_admin_write on profils
  for all using (current_role_type() = 'administrateur')
  with check (current_role_type() = 'administrateur');

-- ---- produits : lecture par tous les comptes actifs ; écriture par gestionnaire+
create policy produits_read on produits
  for select using (current_role_type() is not null);

create policy produits_write on produits
  for insert with check (current_role_type() in ('gestionnaire', 'administrateur'));

create policy produits_update on produits
  for update using (current_role_type() in ('gestionnaire', 'administrateur'));

-- ---- demandes : le vendeur voit/crée les siennes, gestionnaire+ voit tout et change le statut
create policy demandes_insert on demandes
  for insert with check (
    current_role_type() in ('vendeur', 'gestionnaire', 'administrateur')
    and vendeur_id = (select id from profils where user_id = auth.uid())
  );

create policy demandes_select on demandes
  for select using (
    current_role_type() in ('gestionnaire', 'administrateur')
    or vendeur_id = (select id from profils where user_id = auth.uid())
  );

create policy demandes_update on demandes
  for update using (current_role_type() in ('gestionnaire', 'administrateur'));

-- ---- notifications : lecture/écriture réservées à gestionnaire+ (le vendeur n'a pas besoin du détail d'envoi)
create policy notifications_all on notifications
  for all using (current_role_type() in ('gestionnaire', 'administrateur'))
  with check (current_role_type() in ('gestionnaire', 'administrateur'));

-- ---- imports_stock : gestionnaire+ uniquement
create policy imports_all on imports_stock
  for all using (current_role_type() in ('gestionnaire', 'administrateur'))
  with check (current_role_type() in ('gestionnaire', 'administrateur'));

-- ---- journal_audit : lecture administrateur uniquement ; écriture par le backend (service role)
create policy audit_admin_read on journal_audit
  for select using (current_role_type() = 'administrateur');
-- Aucune policy INSERT ici : les écritures se font via la clé service_role du backend (Railway),
-- qui contourne RLS — jamais depuis le client.

-- =====================================================================
-- Trigger d'audit automatique sur les changements de statut sensibles
-- =====================================================================
create function log_changement_statut() returns trigger
language plpgsql security definer as $$
begin
  insert into journal_audit (user_id, action, cible_type, cible_id, details)
  values (
    (select id from profils where user_id = auth.uid()),
    'changement_statut',
    'demande',
    new.id,
    jsonb_build_object('avant', old.statut, 'apres', new.statut)
  );
  return new;
end;
$$;

create trigger trg_demandes_statut
  after update of statut on demandes
  for each row
  when (old.statut is distinct from new.statut)
  execute function log_changement_statut();

create function log_changement_role() returns trigger
language plpgsql security definer as $$
begin
  insert into journal_audit (user_id, action, cible_type, cible_id, details)
  values (
    (select id from profils where user_id = auth.uid()),
    'changement_role',
    'profil',
    new.id,
    jsonb_build_object('avant', old.role, 'apres', new.role)
  );
  return new;
end;
$$;

create trigger trg_profils_role
  after update of role on profils
  for each row
  when (old.role is distinct from new.role)
  execute function log_changement_role();
