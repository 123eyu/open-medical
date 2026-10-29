-- Follow-up tables historically lived in the fixed store. They keep their
-- original names and column layout and are now owned by this plugin. The
-- migration is additive: existing databases already have both tables and the
-- IF NOT EXISTS clauses make adoption a no-op.
CREATE TABLE IF NOT EXISTS follow_ups (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, status TEXT NOT NULL, next_due INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS follow_ups_due ON follow_ups(status,next_due);
CREATE TABLE IF NOT EXISTS followup_plans (id TEXT PRIMARY KEY, data TEXT NOT NULL);
