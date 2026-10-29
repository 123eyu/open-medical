CREATE TABLE IF NOT EXISTS review_sessions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, action_id TEXT, patient_id TEXT, model TEXT, context TEXT,
  ai_items INTEGER, modified INTEGER, added INTEGER, deleted INTEGER, review_ms INTEGER,
  ai_snapshot TEXT, final_snapshot TEXT, superseded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS review_action ON review_sessions(action_id) WHERE action_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS review_diffs (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  section TEXT, op TEXT, field TEXT, before TEXT, after TEXT, reason TEXT, category TEXT, learnable INTEGER,
  superseded INTEGER DEFAULT 0, habit_id INTEGER, data TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS review_session_diffs ON review_diffs(session_id);
CREATE TABLE IF NOT EXISTS habit_history (id INTEGER PRIMARY KEY, habit_id INTEGER, decision TEXT, snapshot TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS habit_revision_epoch (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL);
INSERT OR IGNORE INTO habit_revision_epoch(id,epoch) VALUES (1,0);
CREATE TABLE IF NOT EXISTS habit_mutation_receipts (request_id TEXT PRIMARY KEY, habit_id INTEGER NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS habit_patterns (key TEXT PRIMARY KEY, suppressed INTEGER DEFAULT 0, since_id INTEGER DEFAULT 0, memory_id INTEGER);
CREATE TABLE IF NOT EXISTS habit_feedback (id INTEGER PRIMARY KEY, habit_id INTEGER, action_id TEXT, kind TEXT, created_at TEXT, UNIQUE(habit_id,action_id,kind));
CREATE TABLE IF NOT EXISTS learning_events (id INTEGER PRIMARY KEY, type TEXT, subject TEXT, data TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS workbench_prefs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_seen (extension_id TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(extension_id, key));
CREATE TABLE IF NOT EXISTS automation_items (id TEXT PRIMARY KEY, extension_id TEXT NOT NULL, patient_id TEXT, status TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS evolution_signals (kind TEXT NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL, data TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY(kind, key));
CREATE TABLE IF NOT EXISTS evolution_suggestions (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evolution_changes (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
