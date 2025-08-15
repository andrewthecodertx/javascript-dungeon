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

// We don't need server-side validation for this example,
// but this is where you'd put it.
// const playerWidth = 96;
// const playerHeight = 80;
// const canvasWidth = 800;
// const canvasHeight = 600;

wss.on('connection', ws => {
  const id = Math.random().toString(36).substr(2, 9);
  console.log(`Player ${id} connected`);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Initialize player with all required properties for the new animation system
  players[id] = {
    x: Math.floor(Math.random() * 700) + 50,
    y: Math.floor(Math.random() * 500) + 50,
    direction: 'down',
    action: 'IDLE',
    id: id,
    color: colors[Math.floor(Math.random() * colors.length)]
  };

  // Assign the new player their ID
  ws.send(JSON.stringify({ type: 'assign_id', id }));

  // Send the current state of all players to the new player
  ws.send(JSON.stringify({ type: 'update', players }));

  // Inform all other players about the new player
  broadcast({ type: 'update', players });

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'move' && players[id]) {
        // Update player state from client message
        const player = data.player;
        players[id].x = player.x;
        players[id].y = player.y;
        players[id].direction = player.direction;
        players[id].action = player.action;
        broadcast({ type: 'update', players });
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

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', function close() {
  clearInterval(interval);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
