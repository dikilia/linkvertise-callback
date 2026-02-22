const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const linkvertise = require('@hydren/linkvertise'); // ADD THIS PACKAGE
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURE LINKVERTISE ====================
// Your Linkvertise User ID
const LINKVERTISE_USER_ID = '1446949';
linkvertise.config(LINKVERTISE_USER_ID);

// ==================== MIDDLEWARE ====================
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==================== SIMPLE JSON DATABASE ====================
const DB_PATH = path.join(__dirname, 'db', 'keys.json');

async function initDB() {
  try {
    await fs.mkdir(path.join(__dirname, 'db'), { recursive: true });
    try {
      await fs.access(DB_PATH);
    } catch {
      await fs.writeFile(DB_PATH, JSON.stringify({ 
        pending: {}, 
        completed: {},
        users: {}
      }, null, 2));
    }
  } catch (error) {
    console.error('DB init error:', error);
  }
}

async function readDB() {
  const data = await fs.readFile(DB_PATH, 'utf8');
  return JSON.parse(data);
}

async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// ==================== ON COMPLETE CALLBACK FUNCTION ====================
// This runs when user successfully completes the Linkvertise ad
async function onLinkvertiseComplete(req) {
  console.log('✅ Linkvertise completion detected:', req.query);
  
  // Extract parameters (the package passes these automatically)
  const { user_id, script_id, key_index } = req.query;
  
  console.log('📊 Completion data:', { user_id, script_id, key_index });

  if (!user_id || !script_id || key_index === undefined) {
    console.error('❌ Missing required parameters');
    return;
  }

  try {
    const db = await readDB();

    // Initialize user if not exists
    if (!db.users[user_id]) {
      db.users[user_id] = {
        completedKeys: {},
        lastActive: new Date().toISOString()
      };
    }

    // Initialize script for user
    if (!db.users[user_id].completedKeys[script_id]) {
      db.users[user_id].completedKeys[script_id] = [];
    }

    // Mark key as completed
    const keyIndexNum = parseInt(key_index);
    if (!db.users[user_id].completedKeys[script_id].includes(keyIndexNum)) {
      db.users[user_id].completedKeys[script_id].push(keyIndexNum);
      
      // Track in completed list
      if (!db.completed[script_id]) db.completed[script_id] = [];
      db.completed[script_id].push({
        userId: user_id,
        keyIndex: keyIndexNum,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Key ${keyIndexNum} completed for user ${user_id}`);
    }

    db.users[user_id].lastActive = new Date().toISOString();
    await writeDB(db);

  } catch (error) {
    console.error('❌ Error in onComplete:', error);
  }
}

// ==================== MOUNT LINKVERTISE ROUTES ====================
// This creates /go and /callback endpoints automatically
app.use(linkvertise.create({
  type: 'router',
  path: '/go',                    // Users go to /go?user_id=...&script_id=...&key_index=...
  finalPath: '/callback',          // Linkvertise redirects here after ad
  onComplete: onLinkvertiseComplete
}));

// ==================== ENDPOINT TO GENERATE LINK (FOR FRONTEND) ====================
app.post('/api/get-linkvertise-link', async (req, res) => {
  try {
    const { userId, scriptId, keyIndex } = req.body;
    
    if (!userId || !scriptId || keyIndex === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate the URL that users will click
    // This goes to YOUR /go endpoint, which then redirects to Linkvertise
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const goUrl = `${baseUrl}/go?user_id=${userId}&script_id=${scriptId}&key_index=${keyIndex}`;

    // Store in pending
    const db = await readDB();
    if (!db.pending) db.pending = {};
    db.pending[`${userId}:${scriptId}:${keyIndex}`] = {
      userId,
      scriptId,
      keyIndex,
      timestamp: new Date().toISOString(),
      goUrl
    };
    await writeDB(db);

    console.log(`🔗 Generated go link for user ${userId}, script ${scriptId}, key ${keyIndex}`);

    res.json({ 
      success: true, 
      linkvertiseUrl: goUrl  // Send the /go URL to frontend
    });

  } catch (error) {
    console.error('Generate link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== CHECK KEY STATUS ====================
app.get('/api/status/:userId/:scriptId', async (req, res) => {
  try {
    const { userId, scriptId } = req.params;
    
    const db = await readDB();
    const user = db.users[userId];
    
    const completedKeys = user?.completedKeys[scriptId] || [];
    
    res.json({
      success: true,
      completedKeys,
      userId,
      scriptId
    });

  } catch (error) {
    console.error('Key status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    linkvertiseUserId: LINKVERTISE_USER_ID,
    endpoints: ['/go', '/callback', '/api/get-linkvertise-link', '/api/status/:userId/:scriptId']
  });
});

// ==================== DEBUG ENDPOINT ====================
app.get('/debug', (req, res) => {
  res.json({
    message: 'Debug info',
    query: req.query,
    headers: req.headers,
    url: req.url
  });
});

// Initialize and start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('✅ ' + '='.repeat(50));
    console.log(`✅ Linkvertise server running on port ${PORT}`);
    console.log(`✅ Linkvertise User ID: ${LINKVERTISE_USER_ID}`);
    console.log('✅ ' + '='.repeat(50));
    console.log(`📡 Generate link: POST /api/get-linkvertise-link`);
    console.log(`📡 User click endpoint: GET /go (auto-generated by package)`);
    console.log(`📡 Callback endpoint: GET /callback (auto-generated by package)`);
    console.log(`📡 Status check: GET /api/status/:userId/:scriptId`);
    console.log(`📡 Health: GET /health`);
    console.log('✅ ' + '='.repeat(50));
  });
});
