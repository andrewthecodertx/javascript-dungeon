# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a multiplayer dungeon game proof-of-concept using JavaScript, WebSockets, and HTML5 Canvas. Players can move through multiple rooms and see other players in real-time.

## Running the Project

```bash
# Install dependencies
npm install

# Start the server (runs on port 8080 by default, or PORT env variable)
node server/server.js

# Access the game
# Local: http://localhost:8080
# Production: https://developersandbox.xyz/dungeon
```

The production server uses PM2 for process management. To restart in production:
```bash
pm2 restart dungeon
```

## Architecture

### Server-Side (CommonJS)
- **server/server.js** - Main WebSocket server handling:
  - Player connections and state management
  - Real-time game loop running at 60 FPS (`gameTick()` every 16.67ms)
  - Collision detection with tiles and other players
  - Room transitions via doors/stairs
  - Rate limiting (max 60 messages/second per player)
  - Heartbeat pings every 30 seconds

- **server/map.js** - World definition:
  - `TILE_SIZE` constant (32px)
  - `tileTypes` object defining tile properties (walkable, color)
  - `maps` object with room layouts (2D arrays) and door connections
  - Rooms: `room1`, `room2`, `room3`

### Client-Side (ES6)
- **public/game.js** - Client rendering and input:
  - WebSocket connection with automatic protocol detection (ws/wss)
  - Canvas rendering with sprite animations (8 frames per action)
  - Keyboard input handling (arrow keys and vim keys: h/j/k/l)
  - Sprite recoloring system to differentiate players
  - Actions: IDLE, RUN, ATTACK 1 (A key), ATTACK 2 (S key)

- **public/sprites/** - Player sprite sheets organized by:
  - Action folders: IDLE/, RUN/, ATTACK 1/, ATTACK 2/
  - Files: `{action}_{direction}.png` (8 frames horizontal, 96x80px per frame)

### Key Game Mechanics

**Player Physics:**
- Player size: 96x80px (visual)
- Hitbox: 14x26px (server) / 32x40px (client)
- Walk speed: 2px/tick, Run speed: 4px/tick (hold Shift)
- Collision checks all 4 corners of hitbox against tiles and other players

**Room System:**
- Tile type 4 (stairs/doors) triggers room transitions
- When player steps on door tile, server teleports to destination room
- Player spawned one tile away from destination door on walkable tile
- Each room broadcasts only to players within that room

**WebSocket Protocol:**
- Client→Server: `{type: 'input', keys: {...}}`
- Server→Client:
  - `{type: 'assign_id', id: string}`
  - `{type: 'map', layout: [][],  tiles: {}}`
  - `{type: 'update', players: {}}`
  - `{type: 'player_disconnected', id: string}`

## Adding New Rooms

1. Add room definition to `server/map.js` in `maps` object
2. Define layout as 2D array of tile type IDs
3. Add door objects with `{x, y, to: {room, x, y}}` format
4. Update connecting rooms to link back to new room

## Deployment

GitHub Actions automatically deploys on push to `main`:
1. Copies files to production server via SCP
2. Runs `npm install`
3. Restarts PM2 process named "dungeon"

Production path: `/var/www/developersandbox_xyz/dungeon/`
