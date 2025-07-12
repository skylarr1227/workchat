// Server-side Plugin Loader
const fs = require('fs').promises;
const path = require('path');
const express = require('express');

class ServerPluginLoader {
  constructor(io, app) {
    this.io = io;
    this.app = app;
    this.plugins = new Map();
    this.pluginDir = path.join(__dirname, 'plugins');
    this.publicPluginDir = path.join(__dirname, 'public/js/plugins');
    this.cssPluginDir = path.join(__dirname, 'public/css/plugins');
  }

  async initialize() {
    // Create plugin directories if they don't exist
    try {
      await fs.mkdir(this.pluginDir, { recursive: true });
      await fs.mkdir(this.publicPluginDir, { recursive: true });
      await fs.mkdir(this.cssPluginDir, { recursive: true });
    } catch (err) {
      console.error('Error creating plugin directories:', err);
    }

    // Load all plugins
    await this.loadAllPlugins();
  }

  async loadAllPlugins() {
    try {
      const files = await fs.readdir(this.pluginDir);
      
      for (const file of files) {
        const pluginPath = path.join(this.pluginDir, file);
        const stat = await fs.stat(pluginPath);
        
        if (stat.isDirectory()) {
          await this.loadPlugin(file, pluginPath);
        }
      }
    } catch (err) {
      console.error('Error loading plugins:', err);
    }
  }

  async loadPlugin(pluginId, pluginPath) {
    try {
      // Check for config file
      const configPath = path.join(pluginPath, 'config.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      
      // Check for server-side code
      const serverPath = path.join(pluginPath, 'server.js');
      let instance = null;
      
      try {
        await fs.access(serverPath);
        const Plugin = require(serverPath);
        instance = new Plugin(this.io, this.app, this);
        
        if (instance.initialize) {
          await instance.initialize();
        }
        
        console.log(`Server plugin loaded: ${config.name}`);
      } catch (err) {
        // No server.js, client-only plugin
        console.log(`Client-only plugin registered: ${config.name}`);
      }
      
      this.plugins.set(pluginId, {
        instance,
        config,
        path: pluginPath,
        enabled: true
      });
      
      // Set up static routes for client files
      if (config.clientScript) {
        this.app.use(`/js/plugins/${pluginId}`, express.static(pluginPath));
        this.app.use(`/css/plugins/${pluginId}`, express.static(pluginPath));
      }
      
    } catch (err) {
      console.error(`Error loading plugin ${pluginId}:`, err);
    }
  }

  // Hook system for server-side plugins
  async executeHook(hookName, ...args) {
    const results = [];
    
    for (const [id, plugin] of this.plugins) {
      if (plugin.enabled !== false && plugin.instance && plugin.instance[hookName]) {
        try {
          const result = await plugin.instance[hookName](...args);
          results.push(result);
        } catch (err) {
          console.error(`Plugin ${id} hook ${hookName} error:`, err);
        }
      }
    }
    
    return results;
  }

  getActivePlugins() {
    const plugins = [];

    for (const [id, plugin] of this.plugins) {
      plugins.push({
        id,
        name: plugin.config.name,
        version: plugin.config.version,
        enabled: plugin.enabled !== false,
        clientScript: plugin.config.clientScript || false,
        description: plugin.config.description || ''
      });
    }
    
    return plugins;
  }

  async reloadPlugin(pluginId) {
    // Remove old plugin
    const oldPlugin = this.plugins.get(pluginId);
    if (oldPlugin && oldPlugin.instance && oldPlugin.instance.cleanup) {
      await oldPlugin.instance.cleanup();
    }
    
    // Clear require cache
    const pluginPath = path.join(this.pluginDir, pluginId, 'server.js');
    delete require.cache[require.resolve(pluginPath)];
    
    // Reload
    await this.loadPlugin(pluginId, path.join(this.pluginDir, pluginId));
  }

  async enablePlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      await this.loadPlugin(pluginId, path.join(this.pluginDir, pluginId));
      return;
    }

    if (plugin.enabled) return;

    await this.reloadPlugin(pluginId);
    const reloaded = this.plugins.get(pluginId);
    if (reloaded) reloaded.enabled = true;
  }

  async disablePlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.enabled) return;

    if (plugin.instance && plugin.instance.cleanup) {
      await plugin.instance.cleanup();
    }

    plugin.instance = null;
    plugin.enabled = false;
  }
}

module.exports = ServerPluginLoader;
