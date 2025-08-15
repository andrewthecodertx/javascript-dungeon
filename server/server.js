const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));

let players = {};
const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

// Server-side game constants
const playerWidth = 96;
const playerHeight = 80;
const hitboxWidth = 32; // smaller for collision
const hitboxHeight = 40; // smaller for collision
const hitboxOffsetX = (playerWidth - hitboxWidth) / 2;
const hitboxOffsetY = (playerHeight - hitboxHeight) / 2;
const canvasWidth = 800;
const canvasHeight = 600;
const walkSpeed = 2;
const runSpeed = 4;
const validActions = ['IDLE', 'RUN', 'ATTACK 1', 'ATTACK 2'];
const validDirections = ['up', 'down', 'left', 'right'];


function isValidPosition(newPos, playerId) {
  const newHitbox = {
    x: newPos.x + hitboxOffsetX,
    y: newPos.y + hitboxOffsetY,
    width: hitboxWidth,
    height: hitboxHeight
  };

  // Wall collision
  if (newHitbox.x < 0 || newHitbox.x + newHitbox.width > canvasWidth || newHitbox.y < 0 || newHitbox.y + newHitbox.height > canvasHeight) {
    return false;
  }

  // Player collision
  for (const id in players) {
    if (id !== playerId && players[id]) {
      const otherPlayer = players[id];
      const otherHitbox = {
        x: otherPlayer.x + hitboxOffsetX,
        y: otherPlayer.y + hitboxOffsetY,
        width: hitboxWidth,
        height: hitboxHeight
      };

      if (
        newHitbox.x < otherHitbox.x + otherHitbox.width &&
        newHitbox.x + newHitbox.width > otherHitbox.x &&
        newHitbox.y < otherHitbox.y + otherHitbox.height &&
        newHitbox.y + newHitbox.height > otherHitbox.y
      ) {
        return false;
      }
    }
  }
  return true;
}


const MAX_MESSAGES_PER_SECOND = 60;
const ONE_SECOND = 1000;

wss.on('connection', ws => {
  const id = Math.random().toString(36).substr(2, 9);
  console.log(`Player ${id} connected`);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.messageTimestamps = [];

  // Initialize player with all required properties for the new animation system
  players[id] = {
    x: Math.floor(Math.random() * (canvasWidth - playerWidth)),
    y: Math.floor(Math.random() * (canvasHeight - playerHeight)),
    direction: 'down',
    action: 'IDLE',
    id: id,
    color: colors[Math.floor(Math.random() * colors.length)],
    keys: {}, // Store key state on server
    isRunning: false
  };

  // Assign the new player their ID
  ws.send(JSON.stringify({ type: 'assign_id', id }));

  ws.on('message', message => {
    const now = Date.now();
    ws.messageTimestamps = ws.messageTimestamps.filter(timestamp => now - timestamp < ONE_SECOND);

    if (ws.messageTimestamps.length >= MAX_MESSAGES_PER_SECOND) {
      console.log(`Player ${id} exceeded message rate limit. Disconnecting.`);
      ws.terminate();
      return;
    }
    ws.messageTimestamps.push(now);

    try {
      const data = JSON.parse(message);
      const player = players[id];
      if (!player) return;

      // Instead of accepting position, we accept input state
      if (data.type === 'input') {
        // Sanitize and validate inputs
        if (data.keys) {
          player.keys = data.keys; // Store the state of all keys
        }
        if (typeof data.action === 'string' && validActions.includes(data.action)) {
          player.action = data.action;
        }
        if (typeof data.direction === 'string' && validDirections.includes(data.direction)) {
          player.direction = data.direction;
        }
      }
    } catch (error) {
      console.error("Failed to parse message or update player:", error);
    }
  });

  ws.on('close', () => {
    console.log(`Player ${id} disconnected`);
    delete players[id];
    // Inform all other players that this player has disconnected
    broadcast({ type: 'player_disconnected', id });
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for player ${id}:`, error);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function gameTick() {
  // Process movement for all players
  for (const id in players) {
    const player = players[id];
    if (player.action.startsWith('ATTACK')) continue; // No movement during attack

    const currentSpeed = (player.keys['ShiftLeft'] || player.keys['ShiftRight']) ? runSpeed : walkSpeed;
    const newPos = { x: player.x, y: player.y };
    let moved = false;

    if (player.keys['ArrowUp'] || player.keys['KeyK']) {
      newPos.y -= currentSpeed;
      moved = true;
    }
    if (player.keys['ArrowDown'] || player.keys['KeyJ']) {
      newPos.y += currentSpeed;
      moved = true;
    }
    if (player.keys['ArrowLeft'] || player.keys['KeyH']) {
      newPos.x -= currentSpeed;
      moved = true;
    }
    if (player.keys['ArrowRight'] || player.keys['KeyL']) {
      newPos.x += currentSpeed;
      moved = true;
    }

    if (moved && isValidPosition(newPos, id)) {
      player.x = newPos.x;
      player.y = newPos.y;
    }
  }

  // Broadcast the updated state to all clients
  broadcast({ type: 'update', players });
}


const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Start the game loop
setInterval(gameTick, 1000 / 60); // 60 times per second

wss.on('close', function close() {
  clearInterval(interval);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
