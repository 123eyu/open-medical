CREATE TABLE IF NOT EXISTS knowledge_bot_settings(id INTEGER PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_bot_groups(app_id TEXT,chat_id TEXT,data TEXT NOT NULL,PRIMARY KEY(app_id,chat_id));
CREATE TABLE IF NOT EXISTS knowledge_bot_messages(app_id TEXT,message_id TEXT,at INTEGER,PRIMARY KEY(app_id,message_id));
