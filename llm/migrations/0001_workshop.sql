CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'participant' CHECK(role IN ('participant', 'host')),
  profile TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_participant ON sessions(participant_id);
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('case', 'question')),
  title TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  assumption TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT '',
  blocker TEXT NOT NULL DEFAULT 'approach',
  anonymous INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX entries_kind_created ON entries(kind, created_at);
CREATE INDEX entries_author ON entries(author_id);
CREATE TABLE votes (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(entry_id, participant_id)
);
CREATE INDEX votes_participant ON votes(participant_id);
CREATE TABLE reflections (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL,
  before_choice TEXT NOT NULL DEFAULT '',
  after_choice TEXT NOT NULL DEFAULT '',
  assumption TEXT NOT NULL DEFAULT '',
  context_needed TEXT NOT NULL DEFAULT '',
  experiment TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(participant_id, scenario_id)
);
CREATE TABLE updates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN ('agent', 'host')),
  proof_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE room_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  phase INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER,
  spotlight_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL DEFAULT '',
  submissions_open INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
INSERT INTO room_state(id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
