// Load .env for local development (ignored if file doesn't exist)
try { require('dotenv').config(); } catch {}

const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const { createWsServer } = require('./wsHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', routes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const server = http.createServer(app);
createWsServer(server);

server.listen(PORT, () => {
  console.log(`Math Duel server running on port ${PORT}`);
});
