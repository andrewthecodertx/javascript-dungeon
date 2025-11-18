# Project Overview

This project is a proof-of-concept for a multiplayer dungeon game built with JavaScript. It uses Node.js with Express and WebSockets (`ws`) for the server, and HTML5 Canvas for the client-side rendering.

## Architecture

The project is divided into a `server` and a `public` directory.

*   **`server/`**: Contains the Node.js server code.
    *   `server.js`: The main server file that handles WebSocket connections, game logic, player movement, and communication with clients.
    *   `map.js`: Defines the game world, including tile types, map layouts, and connections between rooms.
*   **`public/`**: Contains the client-side code and assets.
    *   `index.html`: The main HTML file for the game.
    *   `game.js`: The main client-side JavaScript file that handles rendering the game on the canvas, processing user input, and communicating with the server via WebSockets.
    *   `styles.css`: Contains the styles for the game's HTML elements.
    *   `sprites/`: Contains the player character sprites for different actions and directions.

## Building and Running

### Prerequisites

*   Node.js and npm installed.

### Running the Project

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Start the server:**
    ```bash
    node server/server.js
    ```

3.  **Open the game in your browser:**
    Open `public/index.html` in your web browser, or navigate to `http://localhost:8080`.

## Development Conventions

*   The server is written in CommonJS module format.
*   The client-side JavaScript is written in standard ES6.
*   The project uses a simple and straightforward coding style.
*   There are no automated tests configured for this project.
