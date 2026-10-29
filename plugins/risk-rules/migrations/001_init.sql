CREATE TABLE IF NOT EXISTS risk_alerts (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, rule_key TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS risk_alerts_key ON risk_alerts(patient_id,rule_key);
CREATE TABLE IF NOT EXISTS lab_monitors (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, data TEXT NOT NULL);
