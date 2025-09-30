const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const { TILE_SIZE, tileTypes, maps } = require('./map');

app.use(express.static(path.join(__dirname, '..', 'public')));

let players = {};
const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];

const playerWidth = 96;
const playerHeight = 80;
const hitboxWidth = 14;
const hitboxHeight = 26;
const hitboxOffsetX = (playerWidth - hitboxWidth) / 2;
const hitboxOffsetY = 30;
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

  if (newHitbox.x < 0 || newHitbox.x + newHitbox.width > canvasWidth || newHitbox.y < 0 || newHitbox.y + newHitbox.height > canvasHeight) {
    return false;
  }

  const map = maps[room];
  if (!map) return false;

  const corners = [
    { x: newHitbox.x, y: newHitbox.y },
    { x: newHitbox.x + newHitbox.width, y: newHitbox.y },
    { x: newHitbox.x, y: newHitbox.y + newHitbox.height },
    { x: newHitbox.x + newHitbox.width, y: newHitbox.y + newHitbox.height }
  ];

  for (const corner of corners) {
    const tileX = Math.floor(corner.x / TILE_SIZE);
    const tileY = Math.floor(corner.y / TILE_SIZE);

    if (tileY < 0 || tileY >= map.layout.length || tileX < 0 || tileX >= map.layout[0].length) {
      return false;
    }

    const tileType = map.layout[tileY][tileX];
    if (!tileTypes[tileType] || !tileTypes[tileType].walkable) {
      return false;
    }
  }

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
    return { x: TILE_SIZE, y: TILE_SIZE };
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
    ws: ws
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

    if (player.teleported) {
      delete player.teleported;
      continue;
    }

    const oldAction = player.action;

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

    const actionChanged = oldAction !== player.action;

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

    if (moved || positionChanged || actionChanged) {
      roomsToUpdate.add(player.room);
    }

    if (positionChanged) {
      const playerTileX = Math.floor((player.x + hitboxOffsetX + hitboxWidth / 2) / TILE_SIZE);
      const playerTileY = Math.floor((player.y + hitboxOffsetY + hitboxHeight / 2) / TILE_SIZE);
      const currentMap = maps[player.room];

      if (currentMap && currentMap.doors) {
        for (const door of currentMap.doors) {
          if (door.x === playerTileX && door.y === playerTileY) {
            const oldRoom = player.room;
            const newRoom = door.to.room;

            // Calculate destination position - place player one tile away from door
            const destX = door.to.x;
            const destY = door.to.y;

            // Determine offset direction based on door position
            let offsetX = 0;
            let offsetY = 0;

            // Check which side of the destination to place the player
            const destMap = maps[newRoom];
            if (destMap) {
              // Try to place player on an adjacent walkable tile
              const adjacentTiles = [
                { dx: 0, dy: 1 },  // below
                { dx: 0, dy: -1 }, // above
                { dx: 1, dy: 0 },  // right
                { dx: -1, dy: 0 }  // left
              ];

              for (const offset of adjacentTiles) {
                const checkX = destX + offset.dx;
                const checkY = destY + offset.dy;
                if (checkY >= 0 && checkY < destMap.layout.length &&
                    checkX >= 0 && checkX < destMap.layout[0].length) {
                  const tileType = destMap.layout[checkY][checkX];
                  if (tileTypes[tileType] && tileTypes[tileType].walkable && tileType !== 4) {
                    offsetX = offset.dx;
                    offsetY = offset.dy;
                    break;
                  }
                }
              }
            }

            const newX = (destX + offsetX) * TILE_SIZE + (TILE_SIZE - playerWidth) / 2;
            const newY = (destY + offsetY) * TILE_SIZE + (TILE_SIZE - playerHeight) / 2;

            player.room = newRoom;
            player.x = newX;
            player.y = newY;
            player.keys = {};
            player.action = 'IDLE';
            player.teleported = true;

            player.ws.send(JSON.stringify({ type: 'map', layout: maps[newRoom].layout, tiles: tileTypes }));

            roomsToUpdate.add(oldRoom);
            roomsToUpdate.add(newRoom);
            break;
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
