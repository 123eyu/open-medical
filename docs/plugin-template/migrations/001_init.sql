-- 模板迁移：文件名按 001_、002_ 递增，只追加，不修改已应用的迁移。
-- 新表必须使用插件自己的 tablePrefix（这里是 __PLUGIN_TABLE___）。
CREATE TABLE IF NOT EXISTS __PLUGIN_TABLE___notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  text TEXT NOT NULL,
  due_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS __PLUGIN_TABLE___notes_patient
  ON __PLUGIN_TABLE___notes(patient_id, created_at);
