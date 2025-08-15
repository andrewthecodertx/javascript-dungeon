const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

// Determine WebSocket URL based on environment (dev vs. prod)
const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
let wsUrl;

if (isProduction) {
  // In production, the WebSocket server is on the same host.
  wsUrl = `${wsProtocol}//${window.location.host}/server`;
} else {
  // In development, the WebSocket server is on localhost:8080.
  wsUrl = `${wsProtocol}//localhost:8080`;
}

const ws = new WebSocket(wsUrl);

let localPlayerId = null;
let players = {};

const keys = {};
const playerWidth = 96;
const playerHeight = 80;
const hitboxWidth = 32; // smaller for collision
const hitboxHeight = 40; // smaller for collision
const hitboxOffsetX = (playerWidth - hitboxWidth) / 2;
const hitboxOffsetY = (playerHeight - hitboxHeight) / 2;
const walkSpeed = 2;
const runSpeed = 4;
const frameCount = 8;
const animationSpeed = 100; // ms per frame

const baseSprites = {
  'IDLE': {
    'down': new Image(), 'up': new Image(), 'left': new Image(), 'right': new Image()
  },
  'RUN': {
    'down': new Image(), 'up': new Image(), 'left': new Image(), 'right': new Image()
  },
  'ATTACK 1': {
    'down': new Image(), 'up': new Image(), 'left': new Image(), 'right': new Image()
  },
  'ATTACK 2': {
    'down': new Image(), 'up': new Image(), 'left': new Image(), 'right': new Image()
  }
};

let allSpritesLoaded = false;

function loadBaseSprites() {
  let loadedCount = 0;
  const totalImages = Object.keys(baseSprites).reduce((acc, action) => acc + Object.keys(baseSprites[action]).length, 0);

  const onImageLoad = () => {
    loadedCount++;
    if (loadedCount === totalImages) {
      console.log('All base sprites loaded');
      allSpritesLoaded = true;
      gameLoop();
    }
  };

  for (const action in baseSprites) {
    for (const direction in baseSprites[action]) {
      const img = baseSprites[action][direction];
      img.onload = onImageLoad;
      let pathAction = action.toLowerCase();
      if (action.startsWith('ATTACK')) {
        pathAction = action.replace(' ', '').toLowerCase();
      }
      img.src = `sprites/${action}/${pathAction}_${direction}.png`;
    }
  }
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function isSkinTone(r, g, b) {
  // This is a simple skin tone detection. It looks for colors that are reddish/brownish
  // and not too dark or too light. It also excludes grayscale colors.
  const isBrownish = r > g && g > b;
  const isLightEnough = r > 60 && g > 40 && b > 20;
  const isNotTooRed = r < 240;
  const isNotGrayscale = Math.abs(r - g) > 5 || Math.abs(r - b) > 5 || Math.abs(g - b) > 5;

  return isBrownish && isLightEnough && isNotTooRed && isNotGrayscale;
}

function recolorSprite(image, color) {
  const newCanvas = document.createElement('canvas');
  newCanvas.width = image.width;
  newCanvas.height = image.height;
  const ctx = newCanvas.getContext('2d');

  // Draw the original image
  ctx.drawImage(image, 0, 0);

  if (image.width === 0 || image.height === 0) {
    return newCanvas;
  }

  const imageData = ctx.getImageData(0, 0, newCanvas.width, newCanvas.height);
  const data = imageData.data;
  const tintRgb = hexToRgb(color);

  if (!tintRgb) return newCanvas; // Return original if color is invalid

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Skip transparent pixels
    if (a === 0) {
      continue;
    }

    // Check if the pixel is not a skin tone
    if (!isSkinTone(r, g, b)) {
      // Apply tint using a multiply-like effect
      data[i] = (r * tintRgb.r) / 255;
      data[i + 1] = (g * tintRgb.g) / 255;
      data[i + 2] = (b * tintRgb.b) / 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return newCanvas;
}



ws.onopen = () => console.log('Connected to server');

ws.onmessage = event => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'assign_id':
      localPlayerId = data.id;
      break;
    case 'update':
      if (!allSpritesLoaded) return;
      const serverPlayers = data.players;
      const newPlayers = {};
      for (const id in serverPlayers) {
        const serverPlayer = serverPlayers[id];
        const existingPlayer = players[id];

        newPlayers[id] = serverPlayer;

        if (existingPlayer) {
          // Preserve existing animation state and sprites
          newPlayers[id].frame = existingPlayer.frame;
          newPlayers[id].animationTimer = existingPlayer.animationTimer;
          newPlayers[id].sprites = existingPlayer.sprites;
        } else {
          // Initialize animation state and sprites for new player
          newPlayers[id].frame = 0;
          newPlayers[id].animationTimer = 0;
          newPlayers[id].sprites = { 'IDLE': {}, 'RUN': {}, 'ATTACK 1': {}, 'ATTACK 2': {} }; // Create the structure
          for (const action in baseSprites) {
            for (const direction in baseSprites[action]) {
              const baseSpriteSheet = baseSprites[action][direction];
              if (baseSpriteSheet.complete && baseSpriteSheet.naturalHeight !== 0) {
                newPlayers[id].sprites[action][direction] = recolorSprite(baseSpriteSheet, serverPlayer.color);
              } else {
                console.error("Base sprite not loaded, cannot recolor:", baseSpriteSheet.src);
              }
            }
          }
        }
      }
      players = newPlayers;
      break;
    case 'player_disconnected':
      delete players[data.id];
      break;
  }
};

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const id in players) {
    const player = players[id];
    if (!player || !player.sprites) continue;

    // Animate all players based on their state
    player.animationTimer = (player.animationTimer || 0) + 16; // Approximate time per frame
    if (player.animationTimer > animationSpeed) {
      player.frame = (player.frame + 1);
      player.animationTimer = 0;

      if (player.action.startsWith('ATTACK') && player.frame >= frameCount) {
        player.action = 'IDLE';
        player.frame = 0;
      } else {
        player.frame %= frameCount;
      }
    }
    if (player.action === 'IDLE') {
      player.frame = 0;
    }

    const spriteSheet = player.sprites[player.action][player.direction];
    if (spriteSheet) {
      const frameX = player.frame * playerWidth;
      ctx.drawImage(
        spriteSheet,
        frameX, 0, playerWidth, playerHeight, // Source rectangle
        player.x, player.y, playerWidth, playerHeight // Destination rectangle
      );
    }
  }
}

function handleMovement() {
  if (!localPlayerId || !players[localPlayerId]) return;

  const player = players[localPlayerId];
  let action = player.action;
  let direction = player.direction;

  // Do not send updates if an attack is in progress locally.
  // The server will eventually set the action back to IDLE.
  if (action.startsWith('ATTACK')) {
    // we can send an empty message just to keep the connection alive if we want
    // ws.send(JSON.stringify({ type: 'input', keys, action, direction }));
    return;
  }

  let moved = false;

  if (keys['KeyA']) {
    action = 'ATTACK 1';
    player.frame = 0; // Reset frame on new action
  } else if (keys['KeyS']) {
    action = 'ATTACK 2';
    player.frame = 0; // Reset frame on new action
  } else {
    if (keys['ArrowUp'] || keys['KeyK']) {
      direction = 'up';
      moved = true;
    } else if (keys['ArrowDown'] || keys['KeyJ']) {
      direction = 'down';
      moved = true;
    }

    if (keys['ArrowLeft'] || keys['KeyH']) {
      direction = 'left';
      moved = true;
    } else if (keys['ArrowRight'] || keys['KeyL']) {
      direction = 'right';
      moved = true;
    }

    action = moved ? 'RUN' : 'IDLE';
  }

  // Update local player state for immediate feedback before server confirmation
  player.action = action;
  player.direction = direction;

  // Send input state to the server
  ws.send(JSON.stringify({ type: 'input', keys, action, direction }));
}

function gameLoop() {
  handleMovement();
  draw();
  requestAnimationFrame(gameLoop);
}

document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup', e => { keys[e.code] = false; });

loadBaseSprites();
