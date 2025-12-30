# AGENTS.md

Guidelines for AI coding agents working in this JavaScript multiplayer dungeon game repository.

## Build/Run/Test Commands

```bash
# Install dependencies
npm install

# Start development server (port 8080 or PORT env variable)
node server/server.js

# Access locally
open http://localhost:8080

# Production restart (uses PM2)
pm2 restart dungeon
```

### Testing

**No test framework is configured.** The `npm test` command is a placeholder that exits with error.

If adding tests:
- Consider Jest or Vitest for unit tests
- Test server logic (collision detection, room transitions) in isolation
- Mock WebSocket connections for integration tests

### Linting/Formatting

**No linting or formatting tools are configured.** If adding:
- Consider ESLint with a standard config
- Consider Prettier for consistent formatting
- Match existing code style (see below)

## Project Structure

```
server/           # Node.js CommonJS modules
  server.js       # WebSocket server, game loop, collision detection
  map.js          # Room layouts, tile definitions, door connections
public/           # Client-side browser code (vanilla JS)
  game.js         # Canvas rendering, input handling, WebSocket client
  sprites/        # Sprite sheets organized by action and direction
  styles.css      # Minimal styling
index.html        # Entry point
```

## Code Style Guidelines

### Module System

| Location | Format | Example |
|----------|--------|---------|
| `server/` | CommonJS | `const { maps } = require('./map');` |
| `public/` | Browser globals | No imports, vanilla JS |

The `package.json` sets `"type": "commonjs"` - do not use ES modules in server code.

### Formatting

- **Indentation:** 2 spaces
- **Semicolons:** Required on all statements
- **Quotes:** Single quotes in server code, double quotes in client code
- **Braces:** K&R style (opening brace on same line)
- **Line length:** No strict limit, but keep reasonable (~120 chars)

```javascript
// Correct
function doSomething(param) {
  if (param) {
    return true;
  }
  return false;
}

// Incorrect
function doSomething(param)
{
    if (param) { return true }
}
```

### Naming Conventions

| Type | Convention | Examples |
|------|------------|----------|
| Variables | camelCase | `localPlayerId`, `currentRoom` |
| Functions | camelCase | `getSafeSpawnPoint`, `broadcastRoomUpdates` |
| Constants | UPPER_SNAKE_CASE | `TILE_SIZE`, `MAX_MESSAGES_PER_SECOND` |
| Object keys | camelCase | `tileTypes`, `baseSprites` |

### Variable Declarations

- Use `const` for values that won't be reassigned
- Use `let` for mutable state
- Never use `var`

```javascript
const TILE_SIZE = 32;           // Constant value
const players = {};             // Object reference (contents can change)
let currentFrame = 0;           // Mutable counter
```

### Functions

- Use named function declarations for top-level functions
- Use arrow functions for callbacks and short inline functions
- Use destructuring for extracting object properties

```javascript
// Named function declaration
function isValidPosition(newPos, playerId, room) {
  // ...
}

// Arrow function callback
wss.on('connection', ws => {
  // ...
});

// Destructuring
const { TILE_SIZE, tileTypes, maps } = require('./map');
const { ws, ...playerData } = players[id];
```

### Error Handling

- Wrap JSON parsing in try-catch blocks
- Log errors with `console.error()`
- No custom error classes (keep it simple)

```javascript
try {
  const data = JSON.parse(message);
  // process data
} catch (error) {
  console.error("Failed to parse message:", error);
}
```

### Loops

- Use `for...of` for arrays
- Use `for...in` for object keys (or `Object.keys()`)
- Use traditional `for` loops when index is needed

```javascript
// Array iteration
for (const corner of corners) { /* ... */ }

// Object iteration
for (const id in players) { /* ... */ }

// Index-based
for (let y = 0; y < layout.length; y++) { /* ... */ }
```

### Comments

- Minimal inline comments - code should be self-explanatory
- Add comments for non-obvious logic
- No JSDoc (project is small and untyped)

## WebSocket Protocol

### Message Format

All messages are JSON with a `type` field:

```javascript
// Client -> Server
{ type: 'input', keys: { ArrowUp: true, ShiftLeft: false, ... } }

// Server -> Client
{ type: 'assign_id', id: 'abc123' }
{ type: 'map', layout: [[...]], tiles: {...} }
{ type: 'update', players: {...} }
{ type: 'player_disconnected', id: 'abc123' }
```

### Adding New Message Types

1. Define handler in `server/server.js` message handler
2. Update client in `public/game.js` message handler
3. Document the message format

## Game Architecture

### Server Responsibilities

- Authoritative game state
- 60 FPS game loop (`setInterval(gameTick, 1000/60)`)
- Collision detection (tiles and players)
- Room transitions via door tiles
- Rate limiting (60 msg/sec per player)
- Heartbeat pings (30 second intervals)

### Client Responsibilities

- Rendering (Canvas 2D)
- Input capture and transmission
- Sprite animation (8 frames, 100ms each)
- Player color differentiation

### Key Constants

```javascript
TILE_SIZE = 32          // Pixels per tile
PLAYER_WIDTH = 96       // Sprite width
PLAYER_HEIGHT = 80      // Sprite height
HITBOX_WIDTH = 14       // Server collision (32 client)
HITBOX_HEIGHT = 26      // Server collision (40 client)
WALK_SPEED = 2          // Pixels per tick
RUN_SPEED = 4           // Pixels per tick (shift held)
```

## Adding New Features

### New Room

1. Add room layout to `maps` object in `server/map.js`
2. Define 2D array of tile type IDs
3. Add `doors` array with connection objects
4. Update connecting rooms to link back

### New Tile Type

1. Add to `tileTypes` in `server/map.js`
2. Define `walkable` (boolean) and `color` (hex string)
3. Use the new ID in room layouts

### New Player Action

1. Add sprite folder under `public/sprites/`
2. Add sprite files: `{action}_{direction}.png`
3. Load sprites in `public/game.js` `loadBaseSprites()`
4. Add input handling for the action
5. Update server to handle new action state

## Deployment

- **Trigger:** Push to `main` branch
- **CI:** GitHub Actions (`.github/workflows/deploy.yml`)
- **Process Manager:** PM2 (process name: "dungeon")
- **Production URL:** https://developersandbox.xyz/dungeon
