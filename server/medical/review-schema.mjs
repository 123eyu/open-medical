// Fixed tables only. Review drafts and the extra doctor-memory fields are part
// of the fixed pending-action/doctor-profile schema; the learning plugin owns
// the review/habit tables and declares them in its own migration.
export function initializeReviewColumns(db) {
  for (const [table, column, type] of [
    ["pending_actions", "review_draft", "TEXT"],
    ["pending_actions", "review_revision", "INTEGER NOT NULL DEFAULT 0"],
    ["doctor_memories", "origin", "TEXT NOT NULL DEFAULT 'stated'"],
    ["doctor_memories", "rule", "TEXT"],
    ["doctor_memories", "evidence", "TEXT"],
    ["doctor_memories", "dryrun", "TEXT"],
  ]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
