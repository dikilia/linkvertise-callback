const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Simple in-memory storage (resets on restart)
const completedKeys = {};

// Callback endpoint (put this URL in your admin panel)
app.get('/callback', (req, res) => {
  const { user_id, script_id, key_index } = req.query;
  
  if (!user_id || !script_id || !key_index) {
    return res.send('Missing data');
  }

  // Mark as completed
  const key = `${user_id}:${script_id}`;
  if (!completedKeys[key]) completedKeys[key] = [];
  if (!completedKeys[key].includes(key_index)) {
    completedKeys[key].push(key_index);
  }

  console.log(`✅ Key ${key_index} completed for ${user_id}`);

  // Redirect back to your site with success
  res.redirect(`https://dikilia.github.io/lokus-hub?completed=1`);
});

// Check status endpoint
app.get('/status/:userId/:scriptId', (req, res) => {
  const key = `${req.params.userId}:${req.params.scriptId}`;
  res.json({ completedKeys: completedKeys[key] || [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
