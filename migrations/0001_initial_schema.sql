-- Users table (parents and teens)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent', 'teen')),
  parent_id TEXT NULL, -- For teens, references parent's user id
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (parent_id) REFERENCES users(id)
);

-- Parental controls settings
CREATE TABLE IF NOT EXISTS parental_controls (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  teen_id TEXT NOT NULL,
  theological_perspective TEXT DEFAULT 'conservative-christian',
  content_filter_level TEXT DEFAULT 'strict' CHECK (content_filter_level IN ('strict', 'moderate', 'basic')),
  allowed_topics TEXT, -- JSON array of allowed discussion topics
  blocked_keywords TEXT, -- JSON array of blocked keywords
  safety_alerts_enabled BOOLEAN DEFAULT TRUE,
  chat_review_required BOOLEAN DEFAULT TRUE,
  voice_mode_enabled BOOLEAN DEFAULT TRUE,
  daily_time_limit INTEGER DEFAULT 120, -- minutes per day
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES users(id),
  FOREIGN KEY (teen_id) REFERENCES users(id),
  UNIQUE(parent_id, teen_id)
);

-- Custom GPT configurations
CREATE TABLE IF NOT EXISTS custom_gpts (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  theological_values TEXT, -- JSON object of theological perspectives
  educational_focus TEXT, -- JSON array of educational topics
  personality_traits TEXT DEFAULT 'encouraging,wise,patient',
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES users(id)
);

-- Chat conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  teen_id TEXT NOT NULL,
  custom_gpt_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_flagged BOOLEAN DEFAULT FALSE,
  parent_reviewed BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (teen_id) REFERENCES users(id),
  FOREIGN KEY (custom_gpt_id) REFERENCES custom_gpts(id)
);

-- Individual chat messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  audio_url TEXT NULL, -- For voice messages
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Safety alerts for parents
CREATE TABLE IF NOT EXISTS safety_alerts (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL,
  teen_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('self_harm', 'dangerous_behavior', 'inappropriate_content', 'blocked_keyword')),
  alert_reason TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES users(id),
  FOREIGN KEY (teen_id) REFERENCES users(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

-- User sessions for authentication
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_parent_id ON users(parent_id);
CREATE INDEX IF NOT EXISTS idx_parental_controls_parent_teen ON parental_controls(parent_id, teen_id);
CREATE INDEX IF NOT EXISTS idx_conversations_teen_id ON conversations(teen_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_flagged ON messages(is_flagged);
CREATE INDEX IF NOT EXISTS idx_safety_alerts_parent_id ON safety_alerts(parent_id);
CREATE INDEX IF NOT EXISTS idx_safety_alerts_unread ON safety_alerts(is_read);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);