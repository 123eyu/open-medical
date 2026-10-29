CREATE TABLE IF NOT EXISTS care_tasks (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, status TEXT NOT NULL, due_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS care_tasks_patient ON care_tasks(patient_id,status,due_at);
