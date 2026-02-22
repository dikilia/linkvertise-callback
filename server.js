const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const linkvertise = require('@hydren/linkvertise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIGURE LINKVERTISE ====================
const LINKVERTISE_USER_ID = '1446949';
linkvertise.config(LINKVERTISE_USER_ID);

// ==================== MIDDLEWARE ====================
app.use(cors({ 
  origin: ['https://dikilia.github.io', 'http://localhost:3000'],
  credentials: true 
}));
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
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return { pending: {}, completed: {}, users: {} };
  }
}

async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// ==================== ON COMPLETE CALLBACK FUNCTION ====================
async function onLinkvertiseComplete(req) {
  console.log('✅ Linkvertise completion detected:', req.query);
  
  const { user_id, script_id, key_index } = req.query;
  
  console.log('📊 Completion data:', { user_id, script_id, key_index });

  if (!user_id || !script_id || key_index === undefined) {
    console.error('❌ Missing required parameters');
    return;
  }

  try {
    const db = await readDB();

    if (!db.users[user_id]) {
      db.users[user_id] = {
        completedKeys: {},
        lastActive: new Date().toISOString()
      };
    }

    if (!db.users[user_id].completedKeys[script_id]) {
      db.users[user_id].completedKeys[script_id] = [];
    }

    const keyIndexNum = parseInt(key_index);
    if (!db.users[user_id].completedKeys[script_id].includes(keyIndexNum)) {
      db.users[user_id].completedKeys[script_id].push(keyIndexNum);
      
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

    // Don't redirect here - let the package handle it
  } catch (error) {
    console.error('❌ Error in onComplete:', error);
  }
}

// ==================== MOUNT LINKVERTISE ROUTES ====================
app.use(linkvertise.create({
  type: 'router',
  path: '/go',
  finalPath: '/callback',
  onComplete: onLinkvertiseComplete
}));

// ==================== ENDPOINT TO GENERATE LINK ====================
app.post('/api/get-linkvertise-link', async (req, res) => {
  console.log('📩 Received request for link generation:', req.body);
  
  try {
    const { userId, scriptId, keyIndex } = req.body;
    
    console.log('🔍 Extracted params:', { userId, scriptId, keyIndex });

    if (!userId || !scriptId || keyIndex === undefined) {
      console.error('❌ Missing fields:', { userId, scriptId, keyIndex });
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: { userId, scriptId, keyIndex }
      });
    }

    // Generate the URL that users will click
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const goUrl = `${baseUrl}/go?user_id=${userId}&script_id=${scriptId}&key_index=${keyIndex}`;

    console.log('🔗 Generated go URL:', goUrl);

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

    res.json({ 
      success: true, 
      linkvertiseUrl: goUrl,
      message: 'Link generated successfully'
    });

  } catch (error) {
    console.error('❌ Generate link error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// ==================== CHECK KEY STATUS ====================
app.get('/api/status/:userId/:scriptId', async (req, res) => {
  try {
    const { userId, scriptId } = req.params;
    console.log('🔍 Status check for:', { userId, scriptId });
    
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
    console.error('❌ Status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    linkvertiseUserId: LINKVERTISE_USER_ID,
    endpoints: [
      '/go',
      '/callback', 
      '/api/get-linkvertise-link',
      '/api/status/:userId/:scriptId',
      '/health'
    ]
  });
});

// ==================== DEBUG ENDPOINT ====================
app.get('/debug', (req, res) => {
  res.json({
    message: 'Debug info',
    query: req.query,
    headers: req.headers,
    url: req.url,
    method: req.method,
    env: {
      port: PORT,
      hasSecret: !!process.env.CALLBACK_SECRET
    }
  });
});

// ==================== TEST ENDPOINT ====================
app.post('/test', (req, res) => {
  console.log('📩 Test endpoint hit:', req.body);
  res.json({ received: req.body });
});

// Initialize and start server
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('✅ ' + '='.repeat(50));
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ Linkvertise User ID: ${LINKVERTISE_USER_ID}`);
    console.log('✅ ' + '='.repeat(50));
    console.log(`📡 POST /api/get-linkvertise-link - Generate links`);
    console.log(`📡 GET  /go - Redirect to Linkvertise`);
    console.log(`📡 GET  /callback - Linkvertise callback`);
    console.log(`📡 GET  /api/status/:userId/:scriptId - Check status`);
    console.log(`📡 GET  /health - Health check`);
    console.log(`📡 POST /test - Test endpoint`);
    console.log('✅ ' + '='.repeat(50));
  });
});
