CREATE TABLE IF NOT EXISTS doctor_notification_settings(channel TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS doctor_notification_deliveries(channel TEXT NOT NULL,connection_id TEXT NOT NULL,day TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(channel,connection_id,day));
