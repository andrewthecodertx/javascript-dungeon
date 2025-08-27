const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const { TILE_SIZE, tileTypes, maps } = require('./map');

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));

let players = {};
const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

// Server-side game constants
const playerWidth = 96;
const playerHeight = 80;
const hitboxWidth = 16; // smaller for collision
const hitboxHeight = 28; // Final height adjustment to cover feet
const hitboxOffsetX = (playerWidth - hitboxWidth) / 2;
const hitboxOffsetY = 30; // Fine-tuned offset based on detailed feedback
const canvasWidth = 800;
const canvasHeight = 600;
const walkSpeed = 2;
const runSpeed = 4;
const validActions = ['IDLE', 'RUN', 'ATTACK 1', 'ATTACK 2'];
const validDirections = ['up', 'down', 'left', 'right'];

function isValidPosition(newPos, playerId, room) {
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

  const map = maps[room];
  if (!map) return false; // Room doesn't exist

  // 2. Check tile map collision
  const corners = [
    { x: newHitbox.x, y: newHitbox.y }, // top-left
    { x: newHitbox.x + newHitbox.width, y: newHitbox.y }, // top-right
    { x: newHitbox.x, y: newHitbox.y + newHitbox.height }, // bottom-left
    { x: newHitbox.x + newHitbox.width, y: newHitbox.y + newHitbox.height } // bottom-right
  ];

  for (const corner of corners) {
    const tileX = Math.floor(corner.x / TILE_SIZE);
    const tileY = Math.floor(corner.y / TILE_SIZE);

    if (tileY < 0 || tileY >= map.layout.length || tileX < 0 || tileX >= map.layout[0].length) {
      return false; // Out of map bounds
    }

    const tileType = map.layout[tileY][tileX];
    if (!tileTypes[tileType] || !tileTypes[tileType].walkable) {
      return false; // Not a walkable tile
    }
  }

  // 3. Check player collision
  for (const id in players) {
    if (id !== playerId && players[id] && players[id].room === room) {
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

function getWalkableTiles(room) {
  const walkable = [];
  const map = maps[room];
  if (!map) return walkable;

  for (let y = 0; y < map.layout.length; y++) {
    for (let x = 0; x < map.layout[y].length; x++) {
      if (tileTypes[map.layout[y][x]].walkable) {
        walkable.push({ x, y });
      }
    }
  }
  return walkable;
}

function getSafeSpawnPoint(room) {
  const walkableTiles = getWalkableTiles(room);
  if (walkableTiles.length === 0) {
    return { x: TILE_SIZE, y: TILE_SIZE }; // Fallback
  }

  let attempts = 0;
  while (attempts < 100) {
    const randomTile = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
    const potentialPos = {
      x: randomTile.x * TILE_SIZE + (TILE_SIZE - playerWidth) / 2,
      y: randomTile.y * TILE_SIZE + (TILE_SIZE - playerHeight) / 2
    };

    if (isValidPosition(potentialPos, null, room)) {
      return potentialPos;
    }
    attempts++;
  }
  // Fallback if no safe spot is found
  const fallbackTile = walkableTiles[0];
  return {
    x: fallbackTile.x * TILE_SIZE,
    y: fallbackTile.y * TILE_SIZE
  };
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
  const startRoom = 'room1';
  const spawnPoint = getSafeSpawnPoint(startRoom);

  players[id] = {
    x: spawnPoint.x,
    y: spawnPoint.y,
    direction: 'down',
    action: 'IDLE',
    id: id,
    color: colors[Math.floor(Math.random() * colors.length)],
    keys: {},
    room: startRoom,
    ws: ws // Associate websocket with player
  };

  ws.send(JSON.stringify({ type: 'assign_id', id }));
  ws.send(JSON.stringify({ type: 'map', layout: maps[startRoom].layout, tiles: tileTypes }));

  broadcastRoomUpdates(startRoom);

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

      if (data.type === 'input') {
        if (data.keys) {
          // console.log(`Received keys from ${id}:`, data.keys); // DEBUG LOG
          player.keys = data.keys;
        }
      }
    } catch (error) {
      console.error("Failed to parse message or update player:", error);
    }
  });

  ws.on('close', () => {
    console.log(`Player ${id} disconnected`);
    const player = players[id];
    if (player) {
      const room = player.room;
      delete players[id];
      broadcast({ type: 'player_disconnected', id }, room);
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for player ${id}:`, error);
  });
});

function broadcast(data, room) {
  const message = JSON.stringify(data);
  for (const id in players) {
    const player = players[id];
    if (player.room === room && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(message);
    }
  }
}

function broadcastRoomUpdates(room) {
  const playersInRoom = {};
  for (const id in players) {
    if (players[id].room === room) {
      // Send a version of the player object without the websocket
      const { ws, ...playerData } = players[id];
      playersInRoom[id] = playerData;
    }
  }
  broadcast({ type: 'update', players: playersInRoom }, room);
}

function gameTick() {
  const roomsToUpdate = new Set();

  for (const id in players) {
    const player = players[id];
    
    // If player has recently teleported, skip a movement tick to prevent getting stuck
    if (player.teleported) {
      delete player.teleported;
      continue;
    }

    // Server determines action and direction based on keys
    let moved = false;
    if (player.keys['ArrowUp'] || player.keys['KeyK']) {
      player.direction = 'up';
      moved = true;
    } else if (player.keys['ArrowDown'] || player.keys['KeyJ']) {
      player.direction = 'down';
      moved = true;
    } else if (player.keys['ArrowLeft'] || player.keys['KeyH']) {
      player.direction = 'left';
      moved = true;
    } else if (player.keys['ArrowRight'] || player.keys['KeyL']) {
      player.direction = 'right';
      moved = true;
    }

    if (player.keys['KeyA']) {
      player.action = 'ATTACK 1';
    } else if (player.keys['KeyS']) {
      player.action = 'ATTACK 2';
    } else {
      player.action = moved ? 'RUN' : 'IDLE';
    }
    
    // if (id === 'DEBUG_PLAYER_ID') { // Replace with a real ID for targeted debugging
    //   console.log(`Player ${id} keys:`, player.keys, `Action: ${player.action}`); // DEBUG LOG
    // }

    if (player.action.startsWith('ATTACK')) {
      roomsToUpdate.add(player.room);
      continue;
    }

    const currentSpeed = (player.keys['ShiftLeft'] || player.keys['ShiftRight']) ? runSpeed : walkSpeed;
    const newPos = { x: player.x, y: player.y };
    
    let dx = 0;
    let dy = 0;

    if (player.keys['ArrowUp'] || player.keys['KeyK']) dy = -currentSpeed;
    if (player.keys['ArrowDown'] || player.keys['KeyJ']) dy = currentSpeed;
    if (player.keys['ArrowLeft'] || player.keys['KeyH']) dx = -currentSpeed;
    if (player.keys['ArrowRight'] || player.keys['KeyL']) dx = currentSpeed;

    let positionChanged = false;
    if (dx !== 0) {
      newPos.x += dx;
      if (isValidPosition(newPos, id, player.room)) {
        player.x = newPos.x;
        positionChanged = true;
      } else {
        newPos.x -= dx;
      }
    }

    if (dy !== 0) {
      newPos.y += dy;
      if (isValidPosition(newPos, id, player.room)) {
        player.y = newPos.y;
        positionChanged = true;
      } else {
        newPos.y -= dy;
      }
    }

    if (moved || positionChanged) {
      roomsToUpdate.add(player.room);
    }

    if (positionChanged) {
      // Check for door transition
      const playerTileX = Math.floor((player.x + hitboxOffsetX + hitboxWidth / 2) / TILE_SIZE);
      const playerTileY = Math.floor((player.y + hitboxOffsetY + hitboxHeight / 2) / TILE_SIZE);
      const currentMap = maps[player.room];

      if (currentMap && currentMap.doors) {
        for (const door of currentMap.doors) {
          if (door.x === playerTileX && door.y === playerTileY) {
            const oldRoom = player.room;
            const newRoom = door.to.room;
            
            // Determine new position with an offset to avoid getting stuck
            let newX, newY;
            if (newRoom === 'room2') {
              newX = (door.to.x + 1) * TILE_SIZE + (TILE_SIZE - playerWidth) / 2;
              newY = (door.to.y + 1) * TILE_SIZE + (TILE_SIZE - playerHeight) / 2;
            } else { // Assuming back to room1
              newX = (door.to.x + 1) * TILE_SIZE + (TILE_SIZE - playerWidth) / 2;
              newY = door.to.y * TILE_SIZE + (TILE_SIZE - playerHeight) / 2;
            }

            player.room = newRoom;
            player.x = newX;
            player.y = newY;
            player.keys = {}; // Clear keys to stop movement
            player.action = 'IDLE'; // Set action to IDLE
            player.teleported = true; // Flag to prevent getting stuck

            // Notify the client about the map change
            player.ws.send(JSON.stringify({ type: 'map', layout: maps[newRoom].layout, tiles: tileTypes }));

            roomsToUpdate.add(oldRoom);
            roomsToUpdate.add(newRoom);
            break; // Exit loop once a door is found
          }
        }
      }
    }
  }

  roomsToUpdate.forEach(room => broadcastRoomUpdates(room));
}


const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

setInterval(gameTick, 1000 / 60);

wss.on('close', function close() {
  clearInterval(interval);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
