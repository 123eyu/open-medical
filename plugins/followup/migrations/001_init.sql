-- Followup plugin private tables. Every statement is IF NOT EXISTS and keeps
-- the historical column layout; follow_ups/followup_plans remain in the fixed
-- store until T11 and are declared through legacyTables.

CREATE TABLE IF NOT EXISTS followup_applications (
  request_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  jobs TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS followup_creation_requests (
  request_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  job_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS followup_surveys (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  follow_up_id TEXT,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_connector_plugins (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_connections (
  channel TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_bindings (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  account TEXT NOT NULL,
  conversation TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  account TEXT NOT NULL,
  conversation TEXT NOT NULL,
  source_id TEXT NOT NULL,
  data TEXT NOT NULL,
  UNIQUE(channel, account, source_id)
);

CREATE TABLE IF NOT EXISTS chat_drafts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  binding_id TEXT NOT NULL REFERENCES chat_bindings(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS chat_patient_cleanup
AFTER DELETE ON chat_bindings
BEGIN
  DELETE FROM chat_messages
  WHERE channel=OLD.channel
    AND account=OLD.account
    AND conversation=OLD.conversation
    AND NOT EXISTS (
      SELECT 1 FROM chat_bindings b
      WHERE b.channel=OLD.channel
        AND b.account=OLD.account
        AND b.conversation=OLD.conversation
    );
END;

CREATE TABLE IF NOT EXISTS chat_allocations (
  binding_id TEXT NOT NULL REFERENCES chat_bindings(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES chat_drafts(id) ON DELETE CASCADE,
  PRIMARY KEY(binding_id, message_id)
);

CREATE TABLE IF NOT EXISTS chat_outreach (
  job_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_aibot_replies (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  binding_id TEXT NOT NULL REFERENCES chat_bindings(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'wecom-aibot',
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_aibot_groups (
  conversation TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_aibot_group_log (
  id TEXT PRIMARY KEY,
  conversation TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS care_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS care_patient_settings (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS care_message_state (
  message_id INTEGER PRIMARY KEY REFERENCES patient_messages(id) ON DELETE CASCADE,
  patient_id TEXT,
  status TEXT NOT NULL,
  level TEXT NOT NULL,
  category TEXT,
  reasons TEXT NOT NULL,
  reply_id TEXT,
  alert_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS care_message_state_status
  ON care_message_state(status, message_id);

CREATE TABLE IF NOT EXISTS care_replies (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  message_id INTEGER,
  channel TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  text TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS care_replies_status
  ON care_replies(status, created_at);

CREATE TABLE IF NOT EXISTS care_alerts (
  id TEXT PRIMARY KEY,
  patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
  message_id INTEGER,
  level TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS care_alerts_status
  ON care_alerts(status, created_at);

CREATE TABLE IF NOT EXISTS care_campaigns (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
