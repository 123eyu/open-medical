-- Owned by channel-wecom. These tables existed before the plugin migration;
-- every statement is IF NOT EXISTS and keeps the historical column layout.
CREATE TABLE IF NOT EXISTS wecom_contacts (
  corp TEXT NOT NULL,
  member TEXT NOT NULL,
  external TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL,
  updated TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(corp, member, external)
);

CREATE TABLE IF NOT EXISTS wecom_bindings (
  id TEXT PRIMARY KEY,
  corp TEXT NOT NULL,
  member TEXT NOT NULL,
  external TEXT NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  UNIQUE(corp, member, external, patient_id)
);

CREATE TABLE IF NOT EXISTS wecom_tasks (
  id TEXT PRIMARY KEY,
  corp TEXT NOT NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wecom_events (
  id TEXT PRIMARY KEY,
  corp TEXT NOT NULL,
  received TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wecom_groups (
  corp TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  active INTEGER NOT NULL,
  updated TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(corp, chat_id)
);

CREATE TABLE IF NOT EXISTS wecom_group_tasks (
  id TEXT PRIMARY KEY,
  corp TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wecom_directory_state (
  corp TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
