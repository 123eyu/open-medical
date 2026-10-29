CREATE TABLE IF NOT EXISTS trial_protocols(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trial_screenings(trial_id TEXT NOT NULL,patient_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(trial_id,patient_id));
CREATE TABLE IF NOT EXISTS trial_ai_jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trial_enrollments(trial_id TEXT NOT NULL,patient_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(trial_id,patient_id));
CREATE TABLE IF NOT EXISTS trial_batches(id TEXT PRIMARY KEY,trial_id TEXT NOT NULL,data TEXT NOT NULL);
