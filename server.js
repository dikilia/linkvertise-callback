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

// Simple JSON database
const DB_PATH = path.join(__dirname, 'db', 'keys.json');

// Ensure db directory exists
async function initDB() {
  try {
    await fs.mkdir(path.join(__dirname, 'db'), { recursive: true });
    try {
      await fs.access(DB_PATH);
    } catch {
      // Create empty DB if doesn't exist
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

// ==================== FIXED LINKVERTISE CALLBACK ENDPOINT ====================
// This handles the redirect from Linkvertise after user completes ad
app.get('/callback', async (req, res) => {
  console.log('📩 Linkvertise callback received - Full query:', req.query);
  console.log('📩 Full URL:', req.protocol + '://' + req.get('host') + req.originalUrl);
  
  // Linkvertise might send parameters in different formats
  // Try to extract from various possible parameter names
  const userId = req.query.user_id || req.query.userId || req.query.id || req.query.uid;
  const scriptId = req.query.script_id || req.query.scriptId || req.query.sid;
  const keyIndex = req.query.key_index || req.query.keyIndex || req.query.ki;
  
  // Also check if parameters are in the path or nested
  console.log('✅ Extracted params:', { userId, scriptId, keyIndex });

  // If missing data, redirect to frontend with error
  if (!userId || !scriptId || keyIndex === undefined) {
    console.error('❌ Missing required parameters. Query was:', req.query);
    console.error('❌ Headers:', req.headers);
    
    // Still redirect back to frontend so user isn't stuck
    return res.redirect('https://dikilia.github.io/lokus-hub?error=missing_data&details=' + encodeURIComponent(JSON.stringify(req.query)));
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

    // Mark key as completed if not already
    const keyIndexNum = parseInt(keyIndex);
    if (!db.users[userId].completedKeys[scriptId].includes(keyIndexNum)) {
      db.users[userId].completedKeys[scriptId].push(keyIndexNum);
      
      // Also store in completed list for tracking
      if (!db.completed[scriptId]) db.completed[scriptId] = [];
      db.completed[scriptId].push({
        userId: userId,
        keyIndex: keyIndexNum,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Key ${keyIndexNum} for script ${scriptId} completed by user ${userId}`);
    }

    // Remove from pending if exists
    if (db.pending[`${userId}:${scriptId}:${keyIndexNum}`]) {
      delete db.pending[`${userId}:${scriptId}:${keyIndexNum}`];
    }

    db.users[userId].lastActive = new Date().toISOString();
    await writeDB(db);

    // Redirect user back to frontend with success
    res.redirect(`https://dikilia.github.io/lokus-hub?completed=1&key=${keyIndexNum}&script=${scriptId}`);

  } catch (error) {
    console.error('Callback error:', error);
    res.redirect('https://dikilia.github.io/lokus-hub?error=server_error');
  }
});

// ==================== GENERATE LINKVERTISE LINK ====================
// Frontend calls this to get a signed Linkvertise link
app.post('/api/generate-link', async (req, res) => {
  try {
    const { userId, scriptId, keyIndex, linkvertiseUrl } = req.body;

    console.log('📤 Generating link for:', { userId, scriptId, keyIndex, linkvertiseUrl });

    if (!userId || !scriptId || keyIndex === undefined || !linkvertiseUrl) {
      return res.status(400).json({ error: 'Missing required fields', received: req.body });
    }

    // Generate signature for verification
    const signature = crypto
      .createHash('sha256')
      .update(`${userId}:${scriptId}:${keyIndex}:${process.env.CALLBACK_SECRET || 'default-secret-change-me'}`)
      .digest('hex');

    // Create callback URL with all parameters
    const callbackUrl = `${req.protocol}://${req.get('host')}/callback?user_id=${userId}&script_id=${scriptId}&key_index=${keyIndex}&sig=${signature}`;
    
    // Add our parameters to Linkvertise link
    // Linkvertise format: https://link-to.net/USER_ID/CAMPAIGN_ID/dynamic?callback=URL
    const separator = linkvertiseUrl.includes('?') ? '&' : '?';
    const finalUrl = `${linkvertiseUrl}${separator}callback=${encodeURIComponent(callbackUrl)}`;

    // Store in pending
    const db = await readDB();
    if (!db.pending) db.pending = {};
    db.pending[`${userId}:${scriptId}:${keyIndex}`] = {
      userId,
      scriptId,
      keyIndex,
      timestamp: new Date().toISOString(),
      linkvertiseUrl: finalUrl,
      callbackUrl
    };
    await writeDB(db);

    res.json({ 
      success: true, 
      linkvertiseUrl: finalUrl,
      callbackUrl,
      debug: { userId, scriptId, keyIndex }
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
    endpoints: ['/callback', '/api/generate-link', '/api/status/:userId/:scriptId', '/admin/stats']
  });
});

// ==================== DEBUG ENDPOINT ====================
app.get('/debug', (req, res) => {
  res.json({
    message: 'Debug info',
    query: req.query,
    headers: req.headers,
    url: req.url,
    method: req.method
  });
});

// Initialize and start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('✅ ' + '='.repeat(50));
    console.log(`✅ Linkvertise callback server running on port ${PORT}`);
    console.log(`✅ Server URL: http://localhost:${PORT}`);
    console.log(`✅ Public URL: ${process.env.PUBLIC_URL || 'Not set'}`);
    console.log('✅ ' + '='.repeat(50));
    console.log(`📡 Callback URL: /callback`);
    console.log(`📡 Generate link: /api/generate-link`);
    console.log(`📡 Status check: /api/status/:userId/:scriptId`);
    console.log(`📡 Admin stats: /admin/stats`);
    console.log(`📡 Debug: /debug`);
    console.log('✅ ' + '='.repeat(50));
  });
});
