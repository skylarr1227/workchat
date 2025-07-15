# Workplace Chat with PocketAnimals

This repository contains a real-time chat application built with Express and Socket.IO. It also includes the PocketAnimals mini game and a plugin system that allows you to extend the chat with additional features.

## Prerequisites

- **Node.js** `>=16`
- **npm** `>=8`

Ensure these versions are installed before proceeding.

## Installing Dependencies

Run the following command in the repository root to install server and client packages:

```bash
npm install
```

## Running the Server

Start the application with:

```bash
npm start
```

By default the server attempts to start over **HTTPS** on port `443` if SSL certificates are available. Provide the `SSL_KEY_PATH` and `SSL_CERT_PATH` environment variables (or place `ssl/key.pem` and `ssl/cert.pem` in the project root) to enable HTTPS.

If certificates are not found the server falls back to HTTP on port `3000`.
Once running, open your browser and navigate to the appropriate URL (e.g. <https://localhost> when using HTTPS) to access the chat UI and PocketAnimals game.

## Plugin System

Plugins live in the `plugins/` directory and are loaded automatically when the server starts. Each plugin folder typically contains:

- `config.json` &ndash; plugin metadata (id, name, version, etc.)
- `server.js` (optional) &ndash; server-side hooks for extending behaviour
- `client.js` (optional) &ndash; client-side logic loaded in the browser
- `styles.css` (optional) &ndash; styles for the plugin UI

The server uses `plugin-loader.js` to discover plugins and expose their client files under `/js/plugins/{id}` and `/css/plugins/{id}`. The front-end loads enabled plugins through `public/js/plugin-loader.js` and executes their hooks.

### Example Plugin: `user-status`

This repository ships with a `user-status` plugin located in `plugins/user-status`. It adds online/away/busy indicators for users and demonstrates how both server and client code can interact through the hook system.

## Automatic Updates

The server can automatically pull the latest code when changes are pushed to the
repository. Set the `GITHUB_WEBHOOK_SECRET` environment variable and create a
GitHub webhook that sends **push** events to `/git-webhook` on your deployed
server. When a valid webhook is received, the server executes `git pull`
followed by `npm install` to update dependencies, then restarts itself so
the new code is immediately active.


