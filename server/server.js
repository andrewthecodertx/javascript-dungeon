const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const { TILE_SIZE, tileTypes, mapLayout } = require('./map');

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));

let players = {};
const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

// Server-side game constants
const playerWidth = 96;
const playerHeight = 80;
const hitboxWidth = 28; // smaller for collision
const hitboxHeight = 36; // smaller for collision
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

  // 1. Check canvas boundaries
  if (newHitbox.x < 0 || newHitbox.x + newHitbox.width > canvasWidth || newHitbox.y < 0 || newHitbox.y + newHitbox.height > canvasHeight) {
    return false;
  }

  // 2. Check tile map collision
  // Get the corners of the hitbox
  const topLeft = { x: newHitbox.x, y: newHitbox.y };
  const topRight = { x: newHitbox.x + newHitbox.width, y: newHitbox.y };
  const bottomLeft = { x: newHitbox.x, y: newHitbox.y + newHitbox.height };
  const bottomRight = { x: newHitbox.x + newHitbox.width, y: newHitbox.y + newHitbox.height };

  // Convert corner coordinates to tile indices
  const cornersInTiles = [
    { x: Math.floor(topLeft.x / TILE_SIZE), y: Math.floor(topLeft.y / TILE_SIZE) },
    { x: Math.floor(topRight.x / TILE_SIZE), y: Math.floor(topRight.y / TILE_SIZE) },
    { x: Math.floor(bottomLeft.x / TILE_SIZE), y: Math.floor(bottomLeft.y / TILE_SIZE) },
    { x: Math.floor(bottomRight.x / TILE_SIZE), y: Math.floor(bottomRight.y / TILE_SIZE) }
  ];

  for (const corner of cornersInTiles) {
    const tileId = mapLayout[corner.y] && mapLayout[corner.y][corner.x];
    if (tileId === undefined || !tileTypes[tileId] || !tileTypes[tileId].walkable) {
      return false; // Collision with a non-walkable tile
    }
  }


  // 3. Check player collision
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

// Find all walkable tiles and store their coordinates
const walkableTiles = [];
for (let y = 0; y < mapLayout.length; y++) {
  for (let x = 0; x < mapLayout[y].length; x++) {
    const tileId = mapLayout[y][x];
    if (tileTypes[tileId] && tileTypes[tileId].walkable) {
      walkableTiles.push({ x, y });
    }
  }
}

function getSafeSpawnPoint() {
  let spawnPoint = null;
  let attempts = 0;
  while (spawnPoint === null && attempts < 100) {
    const randomTile = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
    // Center the hitbox in the middle of the tile
    const hitboxX = randomTile.x * TILE_SIZE + (TILE_SIZE - hitboxWidth) / 2;
    const hitboxY = randomTile.y * TILE_SIZE + (TILE_SIZE - hitboxHeight) / 2;

    const potentialPoint = {
      x: hitboxX - hitboxOffsetX,
      y: hitboxY - hitboxOffsetY
    };

    // Use isValidPosition to ensure the entire hitbox is clear.
    // We pass a dummy playerId because no player exists yet.
    if (isValidPosition(potentialPoint, 'dummy_id_for_spawn_check')) {
      spawnPoint = potentialPoint;
    }
    attempts++;
  }
  if (!spawnPoint) {
    // As a fallback, just use the first walkable tile. This should rarely happen.
    const fallbackTile = walkableTiles[0];
    spawnPoint = { x: fallbackTile.x * TILE_SIZE, y: fallbackTile.y * TILE_SIZE };
    console.error("Could not find a valid spawn point after 100 attempts. Using fallback.");
  }
  return spawnPoint;
}

wss.on('connection', ws => {
  const id = Math.random().toString(36).substr(2, 9);
  console.log(`Player ${id} connected`);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.messageTimestamps = [];

  const spawnPoint = getSafeSpawnPoint();

  // Initialize player with all required properties for the new animation system
  players[id] = {
    x: spawnPoint.x,
    y: spawnPoint.y,
    direction: 'down',
    action: 'IDLE',
    id: id,
    color: colors[Math.floor(Math.random() * colors.length)],
    keys: {}, // Store key state on server
    isRunning: false
  };

  // Assign the new player their ID
  ws.send(JSON.stringify({ type: 'assign_id', id }));

  // Send the map layout to the new player
  ws.send(JSON.stringify({ type: 'map', layout: mapLayout, tiles: tileTypes }));

  // Send the complete player list to the new player and inform others
  broadcast({ type: 'update', players });

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
      player.direction = 'up';
      moved = true;
    }
    if (player.keys['ArrowDown'] || player.keys['KeyJ']) {
      newPos.y += currentSpeed;
      player.direction = 'down';
      moved = true;
    }
    if (player.keys['ArrowLeft'] || player.keys['KeyH']) {
      newPos.x -= currentSpeed;
      player.direction = 'left';
      moved = true;
    }
    if (player.keys['ArrowRight'] || player.keys['KeyL']) {
      newPos.x += currentSpeed;
      player.direction = 'right';
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
