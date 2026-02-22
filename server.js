const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Your Linkvertise User ID
const LINKVERTISE_USER_ID = '1446949';

// Simple JSON database
const DB_PATH = path.join(__dirname, 'db', 'keys.json');

// Ensure db directory exists
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

// Read database
async function readDB() {
  const data = await fs.readFile(DB_PATH, 'utf8');
  return JSON.parse(data);
}

// Write database
async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// ==================== GENERATE LINKVERTISE LINK ====================
function generateLinkvertiseLink(userId, scriptId, keyIndex, baseUrl) {
  // Create callback URL
  const callbackUrl = `${baseUrl}/callback?user_id=${userId}&script_id=${scriptId}&key_index=${keyIndex}`;
  
  // Generate Linkvertise link with your user ID
  // Format: https://link-to.net/USER_ID/CAMPAIGN_ID/dynamic?callback=URL
  // Using a generic campaign ID - you can customize this
  const campaignId = Math.floor(Math.random() * 1000000); // Random campaign ID
  const linkvertiseUrl = `https://link-to.net/${LINKVERTISE_USER_ID}/${campaignId}/dynamic?callback=${encodeURIComponent(callbackUrl)}`;
  
  return {
    linkvertiseUrl,
    callbackUrl,
    campaignId
  };
}

// ==================== ENDPOINT TO GET LINKVERTISE LINK ====================
app.post('/api/get-linkvertise-link', async (req, res) => {
  try {
    const { userId, scriptId, keyIndex } = req.body;
    
    if (!userId || !scriptId || keyIndex === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate the full URL for callbacks
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    // Generate Linkvertise link
    const { linkvertiseUrl, callbackUrl, campaignId } = generateLinkvertiseLink(
      userId, 
      scriptId, 
      keyIndex,
      baseUrl
    );

    // Store in pending
    const db = await readDB();
    if (!db.pending) db.pending = {};
    db.pending[`${userId}:${scriptId}:${keyIndex}`] = {
      userId,
      scriptId,
      keyIndex,
      campaignId,
      timestamp: new Date().toISOString(),
      callbackUrl
    };
    await writeDB(db);

    console.log(`🔗 Generated Linkvertise link for user ${userId}, script ${scriptId}, key ${keyIndex}`);
    
    res.json({ 
      success: true, 
      linkvertiseUrl,
      callbackUrl
    });

  } catch (error) {
    console.error('Generate link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== CALLBACK ENDPOINT ====================
app.get('/callback', async (req, res) => {
  console.log('📩 Linkvertise callback received:', req.query);
  
  // Extract parameters
  const userId = req.query.user_id;
  const scriptId = req.query.script_id;
  const keyIndex = req.query.key_index;
  
  console.log('✅ Extracted params:', { userId, scriptId, keyIndex });

  if (!userId || !scriptId || keyIndex === undefined) {
    console.error('❌ Missing parameters!');
    return res.redirect('https://dikilia.github.io/lokus-hub?error=missing_params');
  }

  try {
    // Read database
    const db = await readDB();

    // Initialize user if not exists
    if (!db.users[userId]) {
      db.users[userId] = {
        completedKeys: {},
        lastActive: new Date().toISOString()
      };
    }

    // Initialize script for user
    if (!db.users[userId].completedKeys[scriptId]) {
      db.users[userId].completedKeys[scriptId] = [];
    }

    // Mark key as completed
    const keyIndexNum = parseInt(keyIndex);
    if (!db.users[userId].completedKeys[scriptId].includes(keyIndexNum)) {
      db.users[userId].completedKeys[scriptId].push(keyIndexNum);
      
      // Track in completed list
      if (!db.completed[scriptId]) db.completed[scriptId] = [];
      db.completed[scriptId].push({
        userId,
        keyIndex: keyIndexNum,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Key ${keyIndexNum} completed for user ${userId}`);
    }

    // Remove from pending
    if (db.pending[`${userId}:${scriptId}:${keyIndexNum}`]) {
      delete db.pending[`${userId}:${scriptId}:${keyIndexNum}`];
    }

    db.users[userId].lastActive = new Date().toISOString();
    await writeDB(db);

    // Redirect back to frontend
    res.redirect(`https://dikilia.github.io/lokus-hub?completed=1&key=${keyIndexNum}&script=${scriptId}&user=${userId}`);

  } catch (error) {
    console.error('❌ Callback error:', error);
    res.redirect('https://dikilia.github.io/lokus-hub?error=server_error');
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
    console.error('Key status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ADMIN: VIEW STATS ====================
app.get('/admin/stats', async (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.ADMIN_PASSWORD || 'noobie123admin'}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = await readDB();
    
    const stats = {
      totalUsers: Object.keys(db.users || {}).length,
      totalCompletions: Object.values(db.completed || {}).reduce((sum, arr) => sum + arr.length, 0),
      pendingCount: Object.keys(db.pending || {}).length,
      users: db.users,
      completions: db.completed,
      pending: db.pending,
      linkvertiseUserId: LINKVERTISE_USER_ID,
      serverTime: new Date().toISOString()
    };

    res.json(stats);

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    linkvertiseUserId: LINKVERTISE_USER_ID,
    endpoints: ['/api/get-linkvertise-link', '/callback', '/api/status/:userId/:scriptId', '/admin/stats']
  });
});

// Initialize and start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('✅ ' + '='.repeat(50));
    console.log(`✅ Linkvertise callback server running on port ${PORT}`);
    console.log(`✅ Linkvertise User ID: ${LINKVERTISE_USER_ID}`);
    console.log('✅ ' + '='.repeat(50));
    console.log(`📡 Get Linkvertise link: POST /api/get-linkvertise-link`);
    console.log(`📡 Callback URL: GET /callback`);
    console.log(`📡 Status check: GET /api/status/:userId/:scriptId`);
    console.log(`📡 Admin stats: GET /admin/stats`);
    console.log('✅ ' + '='.repeat(50));
  });
});
