// server.js - Enhanced with PocketAnimals integration
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const ServerPluginLoader = require('./plugin-loader');

// Configuration
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, '/etc/letsencrypt/live/sidechat.work/privkey.pem');
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, '/etc/letsencrypt/live/sidechat.work/fullchain.pem');
const useHttps = fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH);
const PORT = process.env.PORT || (useHttps ? 443 : 3000);
const USER_PASSWORD = '1';
const ADMIN_PASSWORD = '2';
const EDIT_DELETE_WINDOW = 5 * 60 * 1000; // 5 minutes
const MAX_MESSAGE_LENGTH = 2000;
const MAX_ROOM_NAME_LENGTH = 50;
const MAX_USERNAME_LENGTH = 30;
const MAX_MESSAGES_PER_ROOM = 500;
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_MESSAGES_PER_MINUTE = 30;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

// Create directories
const uploadsDir = path.join(__dirname, 'uploads');
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite Database
const dbPath = process.env.NODE_ENV === 'test'
  ? ':memory:'
  : (process.env.REPL_ID ? './pocketanimals.db' : path.join(dbDir, 'pocketanimals.db'));
const db = new sqlite3.Database(dbPath);

db.on('trace', (sql) => {
  console.log('SQL:', sql);
});

db.on('error', (err) => {
  console.error('Database error:', err);
});


console.log(`Database path: ${dbPath}`);

// Database initialization
function initDatabase() {
  return new Promise((resolve, reject) => {
    console.log('Initializing database...');

    // Test database connection first
    db.get('SELECT 1 as test', (err, row) => {
      if (err) {
        console.error('Database connection failed:', err);
        reject(err);
        return;
      }
      console.log('Database connection successful');
    });

    db.serialize(() => {
      // Users table
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_color TEXT DEFAULT '#ffffff',
        cowoncy INTEGER DEFAULT 100,
        experience INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        lootboxes INTEGER DEFAULT 0,
        weapon_crates INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_admin BOOLEAN DEFAULT 0
      )`, (err) => {
        if (err) {
          console.error('Error creating users table:', err);
          reject(err);
          return;
        }
        console.log('Users table ready');
      });

      // Animals table
      db.run(`CREATE TABLE IF NOT EXISTS animals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        rarity TEXT NOT NULL,
        level INTEGER DEFAULT 1,
        str INTEGER NOT NULL,
        mag INTEGER NOT NULL,
        pr INTEGER NOT NULL,
        mr INTEGER NOT NULL,
        hp INTEGER NOT NULL,
        current_hp INTEGER NOT NULL,
        wp INTEGER DEFAULT 10,
        caught_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_in_team BOOLEAN DEFAULT 0,
        team_position INTEGER,
        held_item TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error('Error creating animals table:', err);
          reject(err);
          return;
        }
        console.log('Animals table ready');

        // Add held_item column if it does not exist (for older DBs)
        db.all("PRAGMA table_info(animals)", (err, columns) => {
          if (err) {
            console.error('Error checking animals table columns:', err);
            return;
          }
          const hasHeldItem = columns.some(c => c.name === 'held_item');
          if (!hasHeldItem) {
            db.run('ALTER TABLE animals ADD COLUMN held_item TEXT', (err) => {
              if (err) {
                console.error('Error adding held_item column:', err);
              } else {
                console.log('held_item column added');
              }
            });
          }
        });
      });

      // Inventory table for gems/weapons
      db.run(`CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        item_type TEXT NOT NULL,
        item_name TEXT NOT NULL,
        item_data TEXT,
        quantity INTEGER DEFAULT 1,
        acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error('Error creating inventory table:', err);
          reject(err);
          return;
        }
        console.log('Inventory table ready');
      });

      // Battle history
      db.run(`CREATE TABLE IF NOT EXISTS battles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player1_id INTEGER,
        player2_id INTEGER,
        winner_id INTEGER,
        battle_type TEXT NOT NULL,
        battle_data TEXT,
        reward_amount INTEGER DEFAULT 0,
        fought_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player1_id) REFERENCES users (id),
        FOREIGN KEY (player2_id) REFERENCES users (id),
        FOREIGN KEY (winner_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error('Error creating battles table:', err);
          reject(err);
          return;
        }
        console.log('Battles table ready');
      });

      // Leaderboards view
      db.run(`CREATE TABLE IF NOT EXISTS leaderboard_cache (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        level INTEGER,
        total_animals INTEGER,
        battle_wins INTEGER,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error('Error creating leaderboard_cache table:', err);
          reject(err);
          return;
        }
        console.log('Leaderboard cache table ready');
      });

      // Friends system
      db.run(`CREATE TABLE IF NOT EXISTS friendships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id INTEGER,
        addressee_id INTEGER,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requester_id) REFERENCES users (id),
        FOREIGN KEY (addressee_id) REFERENCES users (id),
        UNIQUE(requester_id, addressee_id)
      )`, (err) => {
        if (err) {
          console.error('Error creating friendships table:', err);
          reject(err);
          return;
        }
        console.log('Friendships table ready');
      });

      // Global events/tournaments
      db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        event_type TEXT NOT NULL,
        start_time DATETIME,
        end_time DATETIME,
        event_data TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )`, (err) => {
        if (err) {
          console.error('Error creating events table:', err);
          reject(err);
          return;
        }
        console.log('Events table ready');
      });

      // Create indexes for better performance
      db.run(`CREATE INDEX IF NOT EXISTS idx_animals_user_id ON animals (user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_animals_rarity ON animals (rarity)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON inventory (user_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_battles_players ON battles (player1_id, player2_id)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships (requester_id, addressee_id)`);

      console.log('Database initialized successfully');
      resolve();
    });
  });
}

// PocketAnimals Game Data
const animals = {
  common: [
    { name: '🐶 Dog', str: 8, mag: 4, pr: 6, mr: 5, hp: 25, reward: 0, xp: 10 },
    { name: '🐱 Cat', str: 6, mag: 8, pr: 5, mr: 7, hp: 20, reward: 0, xp: 10 },
    { name: '🐰 Rabbit', str: 4, mag: 6, pr: 8, mr: 6, hp: 15, reward: 0, xp: 8 },
    { name: '🐭 Mouse', str: 3, mag: 5, pr: 12, mr: 4, hp: 12, reward: 0, xp: 8 },
    { name: '🐸 Frog', str: 5, mag: 7, pr: 6, mr: 8, hp: 18, reward: 0, xp: 9 }
  ],
  uncommon: [
    { name: '🦊 Fox', str: 12, mag: 10, pr: 14, mr: 9, hp: 35, reward: 0, xp: 20 },
    { name: '🐺 Wolf', str: 15, mag: 8, pr: 12, mr: 8, hp: 40, reward: 0, xp: 22 },
    { name: '🦝 Raccoon', str: 10, mag: 12, pr: 16, mr: 10, hp: 30, reward: 0, xp: 18 },
    { name: '🐗 Boar', str: 18, mag: 6, pr: 8, mr: 12, hp: 45, reward: 0, xp: 25 }
  ],
  rare: [
    { name: '🦅 Eagle', str: 20, mag: 15, pr: 22, mr: 12, hp: 50, reward: 0, xp: 35 },
    { name: '🐻 Bear', str: 25, mag: 8, pr: 10, mr: 18, hp: 65, reward: 0, xp: 40 },
    { name: '🦁 Lion', str: 28, mag: 12, pr: 16, mr: 14, hp: 60, reward: 0, xp: 42 },
    { name: '🐯 Tiger', str: 30, mag: 10, pr: 20, mr: 12, hp: 58, reward: 0, xp: 45 }
  ],
  epic: [
    { name: '🐉 Dragon', str: 40, mag: 35, pr: 18, mr: 25, hp: 85, reward: 0, xp: 65 },
    { name: '🦄 Unicorn', str: 25, mag: 40, pr: 28, mr: 30, hp: 70, reward: 0, xp: 60 },
    { name: '🐙 Kraken', str: 35, mag: 30, pr: 15, mr: 22, hp: 80, reward: 0, xp: 62 }
  ],
  legendary: [
    { name: '🔥 Phoenix', str: 50, mag: 45, pr: 30, mr: 35, hp: 100, reward: 0, xp: 85 },
    { name: '⚡ Thunderbird', str: 55, mag: 50, pr: 35, mr: 30, hp: 105, reward: 0, xp: 90 },
    { name: '🌟 Celestial Wolf', str: 45, mag: 40, pr: 40, mr: 40, hp: 95, reward: 0, xp: 80 }
  ],
  fabled: [
    { name: '🌙 Lunar Guardian', str: 70, mag: 60, pr: 45, mr: 50, hp: 130, reward: 0, xp: 120 },
    { name: '☀️ Solar Beast', str: 80, mag: 65, pr: 40, mr: 55, hp: 140, reward: 0, xp: 130 },
    { name: '🌈 Rainbow Spirit', str: 60, mag: 75, pr: 55, mr: 65, hp: 125, reward: 0, xp: 115 }
  ]
};

const rarityChances = {
  common: 600000,
  uncommon: 250000,
  rare: 100000,
  epic: 40000,
  legendary: 9000,
  fabled: 1000
};

const getSellValue = (rarity) => {
  const values = {
    common: 3,
    uncommon: 8,
    rare: 100,
    epic: 1000,
    legendary: 10000,
    fabled: 100000
  };
  return values[rarity] || 1;
};

// Database helper functions
function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'pocketanimals_salt').digest('hex');
}

function getUser(username) {
  return new Promise((resolve, reject) => {
    if (!username) {
      reject(new Error('Username is required'));
      return;
    }
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) {
        console.error('Database error in getUser:', err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function getUserById(userId) {
  return new Promise((resolve, reject) => {
    if (!userId) {
      reject(new Error('User ID is required'));
      return;
    }
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
      if (err) {
        console.error('Database error in getUserById:', err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function createUser(username, password, isAdmin = false) {
  return new Promise((resolve, reject) => {
    if (!username) {
      reject(new Error('Username is required'));
      return;
    }
    const passwordHash = hashPassword(password);
    db.run(
      'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
      [username, passwordHash, isAdmin ? 1 : 0],
      function(err) {
        if (err) {
          console.error('Database error in createUser:', err);
          reject(err);
        } else {
          console.log(`Created user: ${username} with ID: ${this.lastID}`);
          resolve(this.lastID);
        }
      }
    );
  });
}

function updateUserStats(userId, stats) {
  return new Promise((resolve, reject) => {
    if (Object.keys(stats).length === 0) {
      // Just update last_login if no stats provided
      db.run(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [userId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
      return;
    }

    const fields = Object.keys(stats).map(key => `${key} = ?`).join(', ');
    const values = Object.values(stats);
    values.push(userId);

    db.run(
      `UPDATE users SET ${fields}, last_login = CURRENT_TIMESTAMP WHERE id = ?`,
      values,
      function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}


function getUserAnimals(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM animals WHERE user_id = ? ORDER BY caught_at DESC',
      [userId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

function getAnimalById(animalId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM animals WHERE id = ?', [animalId], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
}

function addAnimalToUser(userId, animalData) {
  return new Promise((resolve, reject) => {
    const { name, emoji, rarity, level, str, mag, pr, mr, hp, wp } = animalData;
    db.run(
      `INSERT INTO animals (user_id, name, emoji, rarity, level, str, mag, pr, mr, hp, current_hp, wp) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, emoji, rarity, level, str, mag, pr, mr, hp, hp, wp],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

function getUserTeam(userId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM animals WHERE user_id = ? AND is_in_team = 1 ORDER BY team_position',
      [userId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

function updateTeam(userId, animalIds) {
  return new Promise(async (resolve, reject) => {
    try {
      await runDb('BEGIN TRANSACTION');
      await runDb('UPDATE animals SET is_in_team = 0, team_position = NULL WHERE user_id = ?', [userId]);

      const tasks = animalIds.map((animalId, index) => {
        if (animalId) {
          return runDb(
            'UPDATE animals SET is_in_team = 1, team_position = ? WHERE id = ? AND user_id = ?',
            [index, animalId, userId]
          );
        }
        return Promise.resolve();
      });

      await Promise.all(tasks);
      await runDb('COMMIT');
      resolve();
    } catch (err) {
      try { await runDb('ROLLBACK'); } catch (_) {}
      reject(err);
    }
  });
}

async function setTeamSlot(userId, animalId, slot) {
  if (slot < 0 || slot > 2) throw new Error('Invalid team slot');

  await runDb('BEGIN TRANSACTION');
  try {
    await runDb('UPDATE animals SET is_in_team = 0, team_position = NULL WHERE user_id = ? AND team_position = ?', [userId, slot]);
    await runDb('UPDATE animals SET is_in_team = 1, team_position = ? WHERE id = ? AND user_id = ?', [slot, animalId, userId]);
    await runDb('COMMIT');
  } catch (err) {
    try { await runDb('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

function getInventory(userId) {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM inventory WHERE user_id = ? ORDER BY item_name', [userId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function equipItem(userId, animalId, itemName) {
  const item = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM inventory WHERE user_id = ? AND item_name = ? AND quantity > 0', [userId, itemName], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
  if (!item) throw new Error('Item not found in inventory');

  await runDb('UPDATE animals SET held_item = ? WHERE id = ? AND user_id = ?', [itemName, animalId, userId]);
  await runDb('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?', [item.id]);
}

async function unequipItem(userId, animalId) {
  const animal = await new Promise((resolve, reject) => {
    db.get('SELECT held_item FROM animals WHERE id = ? AND user_id = ?', [animalId, userId], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
  if (!animal || !animal.held_item) throw new Error('Animal has no item equipped');

  const itemName = animal.held_item;
  const existing = await new Promise((resolve, reject) => {
    db.get('SELECT id FROM inventory WHERE user_id = ? AND item_name = ?', [userId, itemName], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });

  if (existing) {
    await runDb('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?', [existing.id]);
  } else {
    await runDb('INSERT INTO inventory (user_id, item_type, item_name, quantity) VALUES (?, ?, ?, 1)', [userId, 'misc', itemName]);
  }

  await runDb('UPDATE animals SET held_item = NULL WHERE id = ? AND user_id = ?', [animalId, userId]);
}

async function handleAIBattle(socket, session, opponentIndex) {
  const team = await getUserTeam(session.userId);

  if (team.length === 0) {
    throw new Error('No team set for battle');
  }

  const aiOpponents = [
    { name: 'Newbie Trainer', difficulty: 'Easy', reward: 100 },
    { name: 'Casual Player', difficulty: 'Medium', reward: 200 },
    { name: 'Experienced Hunter', difficulty: 'Hard', reward: 400 },
    { name: 'Elite Master', difficulty: 'Extreme', reward: 800 }
  ];

  const opponent = aiOpponents[opponentIndex];
  if (!opponent) throw new Error('Invalid opponent');

  const playerPower = team.reduce((sum, a) => sum + a.str + a.mag, 0);
  const aiPower = 50 + opponentIndex * 100;
  const winChance = Math.min(0.9, Math.max(0.1, playerPower / (playerPower + aiPower)));
  const won = Math.random() < winChance;

  const user = await getUserById(session.userId);
  await new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO battles (player1_id, battle_type, winner_id, battle_data, reward_amount) VALUES (?, ?, ?, ?, ?)',
      [user.id, 'ai', won ? user.id : null, JSON.stringify({ opponent: opponent.name, playerPower, aiPower }), won ? opponent.reward : 0],
      function(err) { if (err) reject(err); else resolve(); }
    );
  });

  if (won) {
    await updateUserStats(user.id, {
      cowoncy: user.cowoncy + opponent.reward,
      experience: user.experience + opponent.reward / 10
    });
  }

  socket.emit('battle result', {
    success: true,
    won,
    opponent: opponent.name,
    reward: won ? opponent.reward : 0,
    playerPower,
    aiPower
  });

  io.to('pocketanimals').emit('game message', {
    type: 'battle',
    username: session.username,
    won,
    opponent: opponent.name
  });
}

function getLeaderboard(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT u.username, u.level, u.experience, 
              COUNT(a.id) as total_animals,
              COUNT(CASE WHEN b.winner_id = u.id THEN 1 END) as battle_wins
       FROM users u
       LEFT JOIN animals a ON u.id = a.user_id
       LEFT JOIN battles b ON u.id = b.player1_id OR u.id = b.player2_id
       GROUP BY u.id
       ORDER BY u.level DESC, u.experience DESC, total_animals DESC
       LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    cb(null, true);
  }
});

// In-memory state for chat
let rooms = ['lobby', 'pocketanimals'];
const messagesStore = {};
const activeUsers = new Map();
const typingUsers = new Map();
const roomUserCounts = new Map();
const rateLimitMap = new Map();
const userActivityMap = new Map();
const uploadedFiles = new Map();

// Game state for active players
const activeGameSessions = new Map(); // userId -> game session data
const huntCooldowns = new Map(); // userId -> cooldown timestamp
const battleQueues = new Map(); // battleType -> array of userIds

// Initialize Express and HTTP/HTTPS server
const app = express();
app.express = express; // Make express available to plugins
const server = useHttps ?
  https.createServer({
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH)
  }, app) :
  http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});
// Expose active users map for plugins
io.activeUsers = activeUsers;

// Serve static assets
app.use(express.static(path.join(__dirname, '/')));
app.use('/uploads', express.static(uploadsDir));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
// Capture raw body for GitHub webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Initialize plugin system
const pluginLoader = new ServerPluginLoader(io, app);

// API endpoint for plugins
app.get('/api/plugins', (req, res) => {
  res.json(pluginLoader.getActivePlugins());
});

// Game API endpoints
app.get('/api/game/leaderboard', async (req, res) => {
  try {
    const leaderboard = await getLeaderboard(20);
    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/game/user/:username', async (req, res) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const animals = await getUserAnimals(user.id);
    const team = await getUserTeam(user.id);

    // Don't send password hash
    const { password_hash, ...userdata } = user;

    res.json({
      success: true,
      user: userdata,
      animals,
      team
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const fileInfo = {
    id: fileId,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    author: req.body.author || 'Unknown',
    room: req.body.room || 'lobby',
    uploadTime: Date.now()
  };

  uploadedFiles.set(fileId, fileInfo);
  res.json({ success: true, file: fileInfo });
});

app.get('/rooms', (req, res) => res.json({ rooms }));

app.post('/git-webhook', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  if (WEBHOOK_SECRET) {
    const digest = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest('hex');
    if (signature !== digest) {
      return res.status(401).send('Invalid signature');
    }
  }
  if (req.headers['x-github-event'] !== 'push') {
    return res.status(200).send('Ignored');
  }
  console.log('Received GitHub push webhook');
  exec('git pull', (err, stdout, stderr) => {
    if (err) {
      console.error('Git pull failed:', stderr);
      return res.status(500).send('Pull failed');
    }
    console.log('Git pull output:', stdout);
    exec('npm install --omit=dev', (instErr, instStdout, instStderr) => {
      if (instErr) {
        console.error('npm install failed:', instStderr);
      } else {
        console.log('npm install output:', instStdout);
      }
      res.send('Repository updated, restarting server');
      res.on('finish', () => {
        console.log('Restarting server to apply updates');
        process.exit(0);
      });
    });
  });
});

// Utility functions
function sanitizeInput(input, maxLength = 100) {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, maxLength).replace(/[<>]/g, '');
}

function generateMessageId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function checkRateLimit(socketId) {
  const now = Date.now();
  const userLimit = rateLimitMap.get(socketId) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

  if (now > userLimit.resetTime) {
    userLimit.count = 0;
    userLimit.resetTime = now + RATE_LIMIT_WINDOW;
  }

  userLimit.count++;
  rateLimitMap.set(socketId, userLimit);

  return userLimit.count <= MAX_MESSAGES_PER_MINUTE;
}

function updateRoomUserCount(room) {
  const count = Array.from(activeUsers.values()).filter(user => user.room === room).length;
  roomUserCounts.set(room, count);
  io.to(room).emit('room user count', { room, count });
}

function getRoomUsers(room) {
  return Array.from(activeUsers.values())
    .filter(user => user.room === room)
    .map(user => ({
      name: user.username,
      color: user.color,
      isAdmin: user.isAdmin,
      joinTime: user.joinTime
    }));
}

// Game helper functions
function getRandomAnimal() {
  let roll = Math.floor(Math.random() * 1000000);

  let cumulativeChance = 0;
  for (const [rarity, chance] of Object.entries(rarityChances)) {
    cumulativeChance += chance;
    if (roll < cumulativeChance) {
      const animalList = animals[rarity];
      const randomAnimal = animalList[Math.floor(Math.random() * animalList.length)];
      const emoji = randomAnimal.name.split(' ')[0];
      const name = randomAnimal.name.split(' ').slice(1).join(' ');

      return { 
        ...randomAnimal, 
        emoji,
        name: randomAnimal.name,
        rarity, 
        level: 1, 
        current_hp: randomAnimal.hp, 
        wp: 10 
      };
    }
  }

  // Fallback to common
  const commonAnimals = animals.common;
  const randomAnimal = commonAnimals[Math.floor(Math.random() * commonAnimals.length)];
  const emoji = randomAnimal.name.split(' ')[0];

  return { 
    ...randomAnimal, 
    emoji,
    rarity: 'common', 
    level: 1, 
    current_hp: randomAnimal.hp,
    wp: 10 
  };
}

async function performHunt(userId) {
  try {
    const user = await getUserById(userId);  // Fixed: use getUserById instead of getUser
    if (!user) throw new Error('User not found');

    if (user.cowoncy < 5) {
      throw new Error('Not enough cowoncy');
    }

    // Check cooldown
    const cooldownKey = `hunt_${userId}`;
    const lastHunt = huntCooldowns.get(cooldownKey) || 0;
    const now = Date.now();
    if (now - lastHunt < 15000) { // 15 second cooldown
      throw new Error('Hunt is on cooldown');
    }

    // Set cooldown
    huntCooldowns.set(cooldownKey, now);

    // Generate animals (1-3 based on luck)
    const numAnimals = Math.random() < 0.1 ? 3 : Math.random() < 0.3 ? 2 : 1;
    const caughtAnimals = [];

    for (let i = 0; i < numAnimals; i++) {
      const animal = getRandomAnimal();
      await addAnimalToUser(user.id, animal);
      caughtAnimals.push(animal);
    }

    // Update user stats
    const newCowoncy = user.cowoncy - 5;
    const newExp = user.experience + (caughtAnimals.reduce((sum, a) => sum + a.xp, 0));
    const newLevel = Math.floor(newExp / 1000) + 1;

    await updateUserStats(user.id, {
      cowoncy: newCowoncy,
      experience: newExp,
      level: newLevel
    });

    // Random lootbox chance (5%)
    let gotLootbox = false;
    if (Math.random() < 0.05) {
      await updateUserStats(user.id, { lootboxes: user.lootboxes + 1 });
      gotLootbox = true;
    }

    return {
      success: true,
      animals: caughtAnimals,
      cost: 5,
      gotLootbox,
      newStats: {
        cowoncy: newCowoncy,
        experience: newExp,
        level: newLevel,
        lootboxes: gotLootbox ? user.lootboxes + 1 : user.lootboxes
      }
    };
  } catch (error) {
    throw error;
  }
}

async function performSell(userId, animalName, quantity = 1) {
  if (typeof animalName !== 'string' || animalName.trim() === '') {
    throw new Error('Invalid animal name');
  }

  quantity = parseInt(quantity, 10);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive integer');
  }

  animalName = animalName.trim();
  const animals = await getUserAnimals(userId);
  const animalsToSell = animals.filter(a => a.name === animalName);

  if (animalsToSell.length < quantity) {
    throw new Error('Not enough animals to sell');
  }

  const rarity = animalsToSell[0].rarity;
  const sellValue = getSellValue(rarity);
  const totalValue = sellValue * quantity;

  for (let i = 0; i < quantity; i++) {
    await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM animals WHERE id = ? AND user_id = ?',
        [animalsToSell[i].id, userId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  const user = await getUserById(userId);
  await updateUserStats(user.id, { cowoncy: user.cowoncy + totalValue });

  return {
    success: true,
    animalName,
    quantity,
    value: totalValue,
    newCowoncy: user.cowoncy + totalValue
  };
}

// Socket.IO Connection Handler
io.on('connection', async (socket) => {
  console.log('Connected', socket.id);
  
  // Execute plugin hook
  await pluginLoader.executeHook('onConnect', socket);

  // Chat functionality (existing code)
  socket.on('join room', async ({ name, room, password, color }) => {
    const sanitizedName = sanitizeInput(name, MAX_USERNAME_LENGTH);
    const sanitizedRoom = sanitizeInput(room, MAX_ROOM_NAME_LENGTH);
    const sanitizedColor = sanitizeInput(color || '#ffffff', 20);

    if (!sanitizedName || !sanitizedRoom) {
      socket.emit('auth error', 'Invalid name or room');
      return;
    }

    if (!rooms.includes(sanitizedRoom)) {
      socket.emit('auth error', 'Room does not exist');
      return;
    }

    // For PocketAnimals room, handle user registration/login
    if (sanitizedRoom === 'pocketanimals') {
      try {
        let user = await getUser(sanitizedName);
        let isAdmin = false;

        if (password === ADMIN_PASSWORD) {
          isAdmin = true;
        } else if (password === USER_PASSWORD) {
          isAdmin = false;
        } else {
          socket.emit('auth error', 'Invalid password');
          return;
        }

        if (!user) {
          // Create new user
          const userId = await createUser(sanitizedName, password, isAdmin);
          user = await getUser(sanitizedName);
          socket.emit('game message', { 
            type: 'system', 
            message: 'Welcome to PocketAnimals! You\'ve been given 100 starting cowoncy. Type /help for commands!' 
          });
        } else {
          // Existing user - verify password if they provided one
          const expectedHash = hashPassword(password);
          if (user.password_hash !== expectedHash && !isAdmin) {
            socket.emit('auth error', 'Invalid credentials');
            return;
          }

          // Update last login
          await updateUserStats(user.id, {});
        }

        // Store game session
        activeGameSessions.set(socket.id, {
          userId: user.id,
          username: user.username,
          isAdmin: user.is_admin || isAdmin
        });

        socket.gameUser = user;
      } catch (error) {
        console.error('Game login error:', error);
        socket.emit('auth error', 'Database error during login');
        return;
      }
    }

    // Check if username is already taken in this room
    const existingUser = Array.from(activeUsers.values())
      .find(user => user.username.toLowerCase() === sanitizedName.toLowerCase() && user.room === sanitizedRoom);

    if (existingUser) {
      socket.emit('auth error', 'Username already taken in this room');
      return;
    }

    // Store username on the socket for plugins
    socket.username = sanitizedName;

    let isAdmin = false;
    if (password === USER_PASSWORD) {
      isAdmin = false;
    } else if (password === ADMIN_PASSWORD) {
      isAdmin = true;
    } else {
      socket.emit('auth error', 'Invalid password');
      return;
    }

    // Leave previous room
    if (socket.currentRoom) {
      socket.leave(socket.currentRoom);
      updateRoomUserCount(socket.currentRoom);
    }

    socket.isAdmin = isAdmin;
    socket.currentRoom = sanitizedRoom;
    socket.userColor = sanitizedColor;

    activeUsers.set(socket.id, {
      username: sanitizedName,
      room: sanitizedRoom,
      color: sanitizedColor,
      joinTime: Date.now(),
      isAdmin: isAdmin
    });

    socket.emit('login success', { isAdmin, room: sanitizedRoom });
    socket.join(sanitizedRoom);

    const roomUsers = getRoomUsers(sanitizedRoom);
    io.to(sanitizedRoom).emit('user list', roomUsers);
    updateRoomUserCount(sanitizedRoom);

    if (!messagesStore[sanitizedRoom]) messagesStore[sanitizedRoom] = [];
    const recentMessages = messagesStore[sanitizedRoom].slice(-100);
    socket.emit('history', recentMessages);

    socket.to(sanitizedRoom).emit('user joined', { 
      name: sanitizedName, 
      room: sanitizedRoom,
      isAdmin: isAdmin,
      timestamp: Date.now()
    });

    io.emit('rooms updated', rooms);
    console.log(`${sanitizedName} joined room: ${sanitizedRoom}`);
  });

  // Game-specific socket events
  socket.on('game hunt', async () => {
    let session = activeGameSessions.get(socket.id);
    if (!session) {
      // Try to get user from activeUsers and create session
      const user = activeUsers.get(socket.id);
      if (user && user.room === 'pocketanimals') {
        try {
          let dbUser = await getUser(user.username);
          if (!dbUser) {
            const userId = await createUser(user.username, 'defaultpass', user.isAdmin);
            dbUser = await getUser(user.username);
          }
          session = {
            userId: dbUser.id,
            username: dbUser.username,
            isAdmin: dbUser.is_admin || user.isAdmin
          };
          activeGameSessions.set(socket.id, session);
        } catch (error) {
          socket.emit('game error', 'Failed to initialize game session');
          return;
        }
      } else {
        socket.emit('game error', 'Not logged into game');
        return;
      }
    }

    try {
      const result = await performHunt(session.userId);
      socket.emit('hunt result', result);

      // Broadcast to PocketAnimals room
      socket.to('pocketanimals').emit('game message', {
        type: 'hunt',
        username: session.username,
        animals: result.animals
      });
    } catch (error) {
      socket.emit('game error', error.message);
    }
  });

  socket.on('game get data', async () => {
    let session = activeGameSessions.get(socket.id);
    if (!session) {
      // Try to get user from activeUsers and create session
      const user = activeUsers.get(socket.id);
      if (user && user.room === 'pocketanimals') {
        try {
          let dbUser = await getUser(user.username);
          if (!dbUser) {
            const userId = await createUser(user.username, 'defaultpass', user.isAdmin);
            dbUser = await getUser(user.username);
          }
          session = {
            userId: dbUser.id,
            username: dbUser.username,
            isAdmin: dbUser.is_admin || user.isAdmin
          };
          activeGameSessions.set(socket.id, session);
        } catch (error) {
          socket.emit('game error', 'Failed to initialize game session');
          return;
        }
      } else {
        socket.emit('game error', 'Not logged into game');
        return;
      }
    }

    try {
      const user = await getUserById(session.userId);  // Fixed: use getUserById
      const animals = await getUserAnimals(user.id);
      const team = await getUserTeam(user.id);

      // Convert animals to zoo format (count by name)
      const zoo = {};
      animals.forEach(animal => {
        zoo[animal.name] = (zoo[animal.name] || 0) + 1;
      });

      const { password_hash, ...userData } = user;

      socket.emit('game data', {
        user: userData,
        zoo,
        team,
        rawAnimals: animals
      });
    } catch (error) {
      socket.emit('game error', error.message);
    }
  });

  socket.on('game sell animal', async (data) => {
    const session = activeGameSessions.get(socket.id);
    if (!session) {
      socket.emit('game error', 'Not logged into game');
      return;
    }

    try {
      const { animalName, quantity = 1 } = data;
      const result = await performSell(session.userId, animalName, quantity);
      socket.emit('sell result', result);
    } catch (error) {
      console.error('Sell error:', error);
      socket.emit('game error', error.message);
    }
  });

  socket.on('game update team', async (data) => {
    const session = activeGameSessions.get(socket.id);
    if (!session) return;

    try {
      const { teamAnimalIds } = data; // Array of animal IDs or null
      await updateTeam(session.userId, teamAnimalIds);

      const team = await getUserTeam(session.userId);
      socket.emit('team updated', { team });
    } catch (error) {
      socket.emit('game error', error.message);
    }
  });

  socket.on('game level up animal', async (data) => {
    const session = activeGameSessions.get(socket.id);
    if (!session) return;

    try {
      const { animalId } = data;
      const user = await getUser(session.username);

      if (user.cowoncy < 50) {
        socket.emit('game error', 'Not enough cowoncy');
        return;
      }

      // Level up the animal
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE animals SET level = level + 1, str = str + 2, mag = mag + 2, pr = pr + 1, mr = mr + 1, hp = hp + 5, current_hp = hp + 5 WHERE id = ? AND user_id = ?',
          [animalId, user.id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Update user cowoncy
      await updateUserStats(user.id, { cowoncy: user.cowoncy - 50 });

      socket.emit('level up result', {
        success: true,
        animalId,
        newCowoncy: user.cowoncy - 50
      });
    } catch (error) {
      socket.emit('game error', error.message);
    }
  });

  socket.on('game heal team', async () => {
    const session = activeGameSessions.get(socket.id);
    if (!session) return;

    try {
      const user = await getUser(session.username);

      if (user.cowoncy < 30) {
        socket.emit('game error', 'Not enough cowoncy');
        return;
      }

      // Heal all team animals
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE animals SET current_hp = hp WHERE user_id = ? AND is_in_team = 1',
          [user.id],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Update user cowoncy
      await updateUserStats(user.id, { cowoncy: user.cowoncy - 30 });

      socket.emit('heal result', {
        success: true,
        newCowoncy: user.cowoncy - 30
      });
    } catch (error) {
      socket.emit('game error', error.message);
    }
  });

  socket.on('game get leaderboard', async () => {
    try {
      const leaderboard = await getLeaderboard(10);
      socket.emit('leaderboard data', { leaderboard });
    } catch (error) {
      socket.emit('game error', error.message);
    }
  });

  socket.on('game battle ai', async (data) => {
    const session = activeGameSessions.get(socket.id);
    if (!session) return;

    try {
      await handleAIBattle(socket, session, data.opponentIndex);
    } catch (error) {
      socket.emit('game error', error.message);
    }
  });

  // Chat message handler with game commands
  socket.on('chat message', async (msg) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    if (!checkRateLimit(socket.id)) {
      socket.emit('auth error', 'Too many messages. Please slow down.');
      return;
    }

    const room = user.room;
    const sanitizedText = sanitizeInput(msg.text, MAX_MESSAGE_LENGTH);

    if (!sanitizedText) return;

    // Handle game commands in PocketAnimals room
    if (room === 'pocketanimals' && sanitizedText.startsWith('/')) {
      console.log(`Game command received: ${sanitizedText} from ${user.username}`);

      let session = activeGameSessions.get(socket.id);
      console.log(`Current session:`, session);

      // If no session exists, try to create one from the user data
      if (!session) {
        console.log(`No session found, creating one for: ${user.username}`);
        try {
          let dbUser = await getUser(user.username);
          console.log(`DB user lookup result:`, dbUser);

          if (dbUser) {
            session = {
              userId: dbUser.id,
              username: dbUser.username,
              isAdmin: dbUser.is_admin || user.isAdmin
            };
            activeGameSessions.set(socket.id, session);
            socket.gameUser = dbUser;
            console.log(`Session created from existing user:`, session);
          } else {
            // Create new user if doesn't exist
            console.log(`Creating new user for game commands: ${user.username}`);
            const userId = await createUser(user.username, 'defaultpass', user.isAdmin);
            const newUser = await getUser(user.username);
            session = {
              userId: newUser.id,
              username: newUser.username,
              isAdmin: newUser.is_admin || user.isAdmin
            };
            activeGameSessions.set(socket.id, session);
            socket.gameUser = newUser;
            console.log(`Session created from new user:`, session);
          }
        } catch (error) {
          console.error('Error creating game session:', error);
          socket.emit('game message', { 
            type: 'system', 
            message: `Error initializing game session: ${error.message}. Please rejoin the room.` 
          });
          return;
        }
      }

      const command = sanitizedText.split(' ')[0].toLowerCase();
      const args = sanitizedText.split(' ').slice(1);
      console.log(`Processing command: ${command} with args:`, args);

      try {
        switch (command) {
          case '/help':
            socket.emit('game message', {
              type: 'system',
              message: `
🎮 **PocketAnimals Commands:**
/hunt - Hunt for animals (costs 5💰, 15s cooldown)
/zoo - View your animal collection
/team - View your battle team
/team add <animalId> <slot> - Assign an animal to a team slot
/animals - View detailed animal list
/equip <animalId> <item> - Equip item to animal
/unequip <animalId> - Unequip item from animal
/stats - View your player stats
/leaderboard - View top players
/sell [animal] [amount] - Sell animals
/battle [1-4] - Battle AI opponents
/heal - Heal your team (costs 30💰)
/debug - Show debug info
              `.trim()
            });
            return;

          case '/debug':
            socket.emit('game message', {
              type: 'system',
              message: `
🔧 **Debug Info:**
Session ID: ${socket.id}
Username: ${session.username}
User ID: ${session.userId}
Is Admin: ${session.isAdmin}
Active Sessions: ${activeGameSessions.size}
              `.trim()
            });
            return;

          case '/hunt':
            const huntResult = await performHunt(session.userId);
            socket.emit('hunt result', huntResult);

            // Broadcast hunt to room
            const animalNames = huntResult.animals.map(a => a.emoji).join(' ');
            io.to(room).emit('chat message', {
              id: generateMessageId(),
              author: 'PocketAnimals',
              text: `🎯 ${user.username} caught: ${animalNames}`,
              color: '#00ff00',
              timestamp: Date.now(),
              reactions: {},
              room,
              isAdminMessage: false
            });
            return;

          case '/zoo':
            const animals = await getUserAnimals(session.userId);
            const zoo = {};
            animals.forEach(animal => {
              zoo[animal.name] = (zoo[animal.name] || 0) + 1;
            });

            let zooText = '🏛️ **Your Zoo:**\n';
            if (Object.keys(zoo).length === 0) {
              zooText += 'Empty! Go hunting to catch some animals!';
            } else {
              Object.entries(zoo).forEach(([name, count]) => {
                zooText += `${name} ×${count}\n`;
              });
            }

            socket.emit('game message', { type: 'system', message: zooText });
            return;

          case '/team':
            if (args[0] === 'add') {
              const animalId = parseInt(args[1], 10);
              const slot = parseInt(args[2], 10) - 1;
              if (isNaN(animalId) || isNaN(slot)) {
                socket.emit('game message', { type: 'system', message: 'Usage: /team add <animalId> <slot 1-3>' });
                return;
              }
              try {
                await setTeamSlot(session.userId, animalId, slot);
                const team = await getUserTeam(session.userId);
                socket.emit('team updated', { team });
              } catch (err) {
                socket.emit('game error', err.message);
              }
              return;
            }

            const teamAnimals = await getUserTeam(session.userId);

            let teamText = '⚔️ **Your Team:**\n';
            if (teamAnimals.length === 0) {
              teamText += 'No team members set.';
            } else {
              teamAnimals.forEach((a, idx) => {
                const itemInfo = a.held_item ? ` holding ${a.held_item}` : '';
                teamText += `${idx + 1}. ${a.emoji} ${a.name} Lv.${a.level}${itemInfo}\n`;
              });
            }

            socket.emit('game message', { type: 'system', message: teamText });
            return;

          case '/animals':
            const list = await getUserAnimals(session.userId);
            let listText = '🐾 **Your Animals:**\n';
            if (list.length === 0) {
              listText += 'None';
            } else {
              list.forEach(a => {
                const itemInfo = a.held_item ? ` holding ${a.held_item}` : '';
                listText += `ID:${a.id} ${a.emoji} ${a.name} Lv.${a.level}${itemInfo}\n`;
              });
            }
            socket.emit('game message', { type: 'system', message: listText });
            return;

          case '/equip':
            if (args.length < 2) {
              socket.emit('game message', { type: 'system', message: 'Usage: /equip <animalId> <item name>' });
              return;
            }
            try {
              const animalId = parseInt(args[0], 10);
              const itemName = args.slice(1).join(' ');
              await equipItem(session.userId, animalId, itemName);
              socket.emit('game message', { type: 'system', message: 'Item equipped!' });
            } catch (err) {
              socket.emit('game error', err.message);
            }
            return;

          case '/unequip':
            if (args.length < 1) {
              socket.emit('game message', { type: 'system', message: 'Usage: /unequip <animalId>' });
              return;
            }
            try {
              const animalId = parseInt(args[0], 10);
              await unequipItem(session.userId, animalId);
              socket.emit('game message', { type: 'system', message: 'Item removed.' });
            } catch (err) {
              socket.emit('game error', err.message);
            }
            return;

          case '/stats':
            const userStats = await getUserById(session.userId);  // Fixed: use getUserById
            const userAnimals = await getUserAnimals(userStats.id);
            const battleWins = await new Promise((resolve) => {
              db.get('SELECT COUNT(*) as wins FROM battles WHERE winner_id = ?', [userStats.id], (err, row) => {
                resolve(row ? row.wins : 0);
              });
            });

            socket.emit('game message', {
              type: 'system',
              message: `
📊 **${userStats.username}'s Stats:**
💰 Cowoncy: ${userStats.cowoncy}
⭐ Level: ${userStats.level} (${userStats.experience} XP)
🐾 Animals: ${userAnimals.length}
🏆 Battle Wins: ${battleWins}
📦 Lootboxes: ${userStats.lootboxes}
              `.trim()
            });
            return;

          case '/leaderboard':
            const leaderboard = await getLeaderboard(5);
            let leaderText = '🏆 **Top Players:**\n';
            leaderboard.forEach((player, index) => {
              leaderText += `${index + 1}. ${player.username} (Lv.${player.level}, ${player.total_animals} animals)\n`;
            });
            socket.emit('game message', { type: 'system', message: leaderText });
            return;

          case '/sell':
            if (args.length < 1) {
              socket.emit('game message', { type: 'system', message: 'Usage: /sell [animal name] [amount]' });
              return;
            }

            let qty = parseInt(args[args.length - 1], 10);
            const nameParts = isNaN(qty) ? args : args.slice(0, -1);
            if (isNaN(qty)) qty = 1;

            const animalName = nameParts.join(' ').trim();

            if (!animalName) {
              socket.emit('game message', { type: 'system', message: 'Invalid animal name' });
              return;
            }

            if (!Number.isInteger(qty) || qty <= 0) {
              socket.emit('game message', { type: 'system', message: 'Quantity must be a positive integer' });
              return;
            }

            try {
              const result = await performSell(session.userId, animalName, qty);
              socket.emit('sell result', result);
            } catch (error) {
              socket.emit('game error', error.message);
            }
            return;

          case '/battle':
            const opponentIndex = parseInt(args[0]) - 1;
            if (isNaN(opponentIndex) || opponentIndex < 0 || opponentIndex > 3) {
              socket.emit('game message', { 
                type: 'system', 
                message: 'Usage: /battle [1-4]\n1=Newbie, 2=Casual, 3=Experienced, 4=Elite' 
              });
              return;
            }

            try {
              await handleAIBattle(socket, session, opponentIndex);
            } catch (err) {
              socket.emit('game error', err.message);
            }
            return;

          case '/heal':
            socket.emit('game heal team');
            return;

          default:
            socket.emit('game message', { 
              type: 'system', 
              message: 'Unknown command. Type /help for available commands.' 
            });
            return;
        }
      } catch (error) {
        console.error('Game command error:', error);
        socket.emit('game message', { 
          type: 'system', 
          message: `Error: ${error.message}` 
        });
        return;
      }
    }

    // Plugin hook: before message
    const hookResults = await pluginLoader.executeHook('beforeMessage', socket, msg);
    if (hookResults.some(r => r?.cancel)) return;
    
    // Regular chat message
    const id = generateMessageId();
    const timestamp = Date.now();
    const msgObj = {
      id,
      author: user.username,
      text: sanitizedText,
      color: user.color,
      timestamp,
      reactions: { 
        thumbsup: [], heart: [], laugh: [], fire: [],
        clap: [], sad: [], angry: [], surprised: []
      },
      room,
      edited: false,
      editHistory: [],
      isAdminMessage: user.isAdmin,
      file: msg.file || null
    };

    if (!messagesStore[room]) messagesStore[room] = [];
    messagesStore[room].push(msgObj);

    if (messagesStore[room].length > MAX_MESSAGES_PER_ROOM) {
      messagesStore[room] = messagesStore[room].slice(-MAX_MESSAGES_PER_ROOM);
    }

    io.to(room).emit('chat message', msgObj);
    
    // Plugin hook: after message
    await pluginLoader.executeHook('afterMessage', socket, msgObj);

    // Stop typing indicator
    if (typingUsers.has(room)) {
      typingUsers.get(room).delete(user.username);
      if (typingUsers.get(room).size === 0) {
        typingUsers.delete(room);
      }
      socket.to(room).emit('stop typing', { typingUsers: [] });
    }
  });

  // Rest of the existing chat functionality...
  socket.on('set color', ({ color }) => {
    if (activeUsers.has(socket.id)) {
      const user = activeUsers.get(socket.id);
      user.color = color;
      socket.userColor = color;

      const roomUsers = getRoomUsers(user.room);
      io.to(user.room).emit('user list', roomUsers);
    }
  });

  socket.on('create room', ({ room: newRoom, adminPassword }) => {
    if (!socket.isAdmin) {
      socket.emit('auth error', 'Not an admin');
      return;
    }
    if (adminPassword !== ADMIN_PASSWORD) {
      socket.emit('auth error', 'Invalid admin password');
      return;
    }

    const sanitizedRoom = sanitizeInput(newRoom, MAX_ROOM_NAME_LENGTH);
    if (!sanitizedRoom) {
      socket.emit('auth error', 'Invalid room name');
      return;
    }

    if (!rooms.includes(sanitizedRoom)) {
      rooms.push(sanitizedRoom);
      messagesStore[sanitizedRoom] = [];
      roomUserCounts.set(sanitizedRoom, 0);
      io.emit('rooms updated', rooms);
      socket.emit('room created', { room: sanitizedRoom });
      console.log('Room created:', sanitizedRoom);
    } else {
      socket.emit('auth error', 'Room already exists');
    }
  });

  socket.on('delete room', ({ room: roomToDelete, adminPassword }) => {
    if (!socket.isAdmin) {
      socket.emit('auth error', 'Not an admin');
      return;
    }
    if (adminPassword !== ADMIN_PASSWORD) {
      socket.emit('auth error', 'Invalid admin password');
      return;
    }
    if (roomToDelete === 'lobby' || roomToDelete === 'pocketanimals') {
      socket.emit('auth error', 'Cannot delete core rooms');
      return;
    }

    const roomIndex = rooms.indexOf(roomToDelete);
    if (roomIndex > -1) {
      const usersInRoom = Array.from(activeUsers.entries())
        .filter(([, user]) => user.room === roomToDelete);

      usersInRoom.forEach(([socketId, user]) => {
        const userSocket = io.sockets.sockets.get(socketId);
        if (userSocket) {
          userSocket.leave(roomToDelete);
          userSocket.join('lobby');
          userSocket.currentRoom = 'lobby';
          user.room = 'lobby';
          userSocket.emit('forced room change', { newRoom: 'lobby', reason: 'Room was deleted' });
        }
      });

      rooms.splice(roomIndex, 1);
      delete messagesStore[roomToDelete];
      roomUserCounts.delete(roomToDelete);
      typingUsers.delete(roomToDelete);

      io.emit('rooms updated', rooms);
      io.emit('room deleted', { room: roomToDelete });
      console.log('Room deleted:', roomToDelete);
    }
  });

  // Additional existing chat handlers (reactions, editing, etc.)
  socket.on('toggle reaction', ({ messageId, reaction, room }) => {
    const user = activeUsers.get(socket.id);
    if (!user || user.room !== room) return;

    const list = messagesStore[room] || [];
    const m = list.find(x => x.id === messageId);
    if (m && m.reactions.hasOwnProperty(reaction)) {
      const userIndex = m.reactions[reaction].indexOf(user.username);

      if (userIndex === -1) {
        m.reactions[reaction].push(user.username);
      } else {
        m.reactions[reaction].splice(userIndex, 1);
      }

      io.to(room).emit('reaction updated', {
        messageId,
        reaction,
        users: m.reactions[reaction],
        room
      });
    }
  });

  socket.on('edit message', ({ messageId, newText, room }) => {
    const user = activeUsers.get(socket.id);
    if (!user || user.room !== room) return;

    const sanitizedText = sanitizeInput(newText, MAX_MESSAGE_LENGTH);
    if (!sanitizedText) return;

    const list = messagesStore[room] || [];
    const m = list.find(x => x.id === messageId);
    if (m && m.author === user.username && (Date.now() - m.timestamp) <= EDIT_DELETE_WINDOW) {
      if (!m.editHistory) m.editHistory = [];
      m.editHistory.push({
        previousText: m.text,
        editTime: Date.now(),
        editedBy: user.username
      });

      m.text = sanitizedText;
      m.edited = true;
      m.lastEditTime = Date.now();

      io.to(room).emit('message edited', { 
        messageId, 
        newText: sanitizedText, 
        room,
        editTime: m.lastEditTime
      });
    }
  });

  socket.on('delete message', ({ messageId, room }) => {
    const user = activeUsers.get(socket.id);
    if (!user || user.room !== room) return;

    const list = messagesStore[room] || [];
    const idx = list.findIndex(x => x.id === messageId);
    if (idx !== -1) {
      const message = list[idx];
      const canDelete = (message.author === user.username && (Date.now() - message.timestamp) <= EDIT_DELETE_WINDOW) || user.isAdmin;

      if (canDelete) {
        list.splice(idx, 1);
        io.to(room).emit('message deleted', { 
          messageId, 
          room,
          deletedBy: user.username,
          isAdmin: user.isAdmin
        });
      }
    }
  });

  socket.on('typing', ({ room }) => {
    const user = activeUsers.get(socket.id);
    if (!user || user.room !== room) return;

    if (!typingUsers.has(room)) {
      typingUsers.set(room, new Set());
    }
    typingUsers.get(room).add(user.username);

    socket.to(room).emit('typing', { 
      typingUsers: Array.from(typingUsers.get(room))
    });
  });

  socket.on('stop typing', ({ room }) => {
    const user = activeUsers.get(socket.id);
    if (!user || user.room !== room) return;

    if (typingUsers.has(room)) {
      typingUsers.get(room).delete(user.username);
      if (typingUsers.get(room).size === 0) {
        typingUsers.delete(room);
      }
    }

    socket.to(room).emit('stop typing', { 
      typingUsers: typingUsers.has(room) ? Array.from(typingUsers.get(room)) : []
    });
  });

  socket.on('get room stats', () => {
    if (!socket.isAdmin) return;

    const stats = rooms.map(room => ({
      name: room,
      userCount: roomUserCounts.get(room) || 0,
      messageCount: (messagesStore[room] || []).length,
      users: getRoomUsers(room),
      lastActivity: messagesStore[room] && messagesStore[room].length > 0 
        ? messagesStore[room][messagesStore[room].length - 1].timestamp 
        : null
    }));

    socket.emit('room stats', stats);
  });

  socket.on('get files', () => {
    const user = activeUsers.get(socket.id);
    if (!user || !user.isAdmin) return;

    const filesList = Array.from(uploadedFiles.values()).sort((a, b) => b.uploadTime - a.uploadTime);
    socket.emit('files list', filesList);
  });

  socket.on('delete file', ({ fileId }) => {
    const user = activeUsers.get(socket.id);
    if (!user || !user.isAdmin) return;

    const fileInfo = uploadedFiles.get(fileId);
    if (fileInfo) {
      const filePath = path.join(uploadsDir, fileInfo.filename);
      fs.unlink(filePath, (err) => {
        if (err) console.error('Error deleting file:', err);
      });

      uploadedFiles.delete(fileId);
      socket.emit('file deleted', { fileId });
    }
  });

  socket.on('active', () => {
    userActivityMap.set(socket.id, { lastActivity: Date.now(), isActive: true });
  });

  socket.on('inactive', () => {
    userActivityMap.set(socket.id, { lastActivity: Date.now(), isActive: false });
  });

  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      const room = user.room;
      activeUsers.delete(socket.id);

      if (typingUsers.has(room)) {
        typingUsers.get(room).delete(user.username);
        if (typingUsers.get(room).size === 0) {
          typingUsers.delete(room);
        }
        socket.to(room).emit('stop typing', { 
          typingUsers: typingUsers.has(room) ? Array.from(typingUsers.get(room)) : []
        });
      }

      const roomUsers = getRoomUsers(room);
      io.to(room).emit('user list', roomUsers);
      updateRoomUserCount(room);

      socket.to(room).emit('user left', { 
        name: user.username, 
        room,
        timestamp: Date.now()
      });

      console.log(`${user.username} disconnected from ${room}`);
    }

    // Clean up game session
    activeGameSessions.delete(socket.id);
    rateLimitMap.delete(socket.id);
    userActivityMap.delete(socket.id);

    // Plugin hook: on disconnect
    await pluginLoader.executeHook('onDisconnect', socket);
    
    console.log('Disconnected', socket.id);
  });
});

// Initialize database and start server when run directly
if (require.main === module) {
  initDatabase().then(async () => {
    await pluginLoader.initialize();
    server.listen(PORT, () => {
      const protocol = useHttps ? 'https' : 'http';
      console.log(`🚀 Enhanced Chat Server with PocketAnimals running on ${protocol} port ${PORT}`);
      console.log(`💬 Chat rooms: ${rooms.join(', ')}`);
      console.log(`🎮 PocketAnimals game integrated!`);
    });
  }).catch(error => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
}

// Cleanup intervals
if (require.main === module) {
setInterval(() => {
  const now = Date.now();

  // Clean up old hunt cooldowns
  for (const [key, timestamp] of huntCooldowns.entries()) {
    if (now - timestamp > 60000) { // 1 minute
      huntCooldowns.delete(key);
    }
  }

  // Clean up rate limits
  for (const [socketId, limit] of rateLimitMap.entries()) {
    if (!activeUsers.has(socketId) || now > limit.resetTime + RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(socketId);
    }
  }

  // Clean up activity data
  for (const [socketId, activity] of userActivityMap.entries()) {
    if (!activeUsers.has(socketId)) {
      userActivityMap.delete(socketId);
    }
  }

  // Clean up old messages
  Object.keys(messagesStore).forEach(room => {
    if (messagesStore[room].length > MAX_MESSAGES_PER_ROOM) {
      messagesStore[room] = messagesStore[room].slice(-MAX_MESSAGES_PER_ROOM);
    }
  });
}, 60000);

// Update leaderboard cache every 5 minutes
setInterval(async () => {
  try {
    const leaderboard = await getLeaderboard(50);
    // Cache could be stored in database for better performance
    console.log('Leaderboard cache updated');
  } catch (error) {
    console.error('Error updating leaderboard cache:', error);
  }
}, 300000);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing server');
  db.close((err) => {
    if (err) console.error('Error closing database:', err);
    else console.log('Database connection closed');
  });
  server.close(() => {
    console.log('Server closed');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing server');
  db.close((err) => {
    if (err) console.error('Error closing database:', err);
    else console.log('Database connection closed');
  });
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });});

module.exports = {
  initDatabase,
  db,
  createUser,
  addAnimalToUser,
  getUserById,
  getUserAnimals,
  performSell,
  setTeamSlot,
  equipItem,
  unequipItem,
  handleAIBattle
};
