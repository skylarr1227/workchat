// Plugin System for Chat Application
class PluginSystem {
  constructor() {
    this.plugins = new Map();
    this.hooks = {};
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Fetch available plugins from server
      const response = await fetch('/api/plugins');
      const plugins = await response.json();
      
      // Load each plugin
      for (const plugin of plugins) {
        if (plugin.enabled && plugin.clientScript) {
          await this.loadPlugin(plugin.id);
        }
      }
      
      this.initialized = true;
      console.log('Plugin system initialized with', this.plugins.size, 'plugins');
    } catch (error) {
      console.error('Failed to initialize plugin system:', error);
    }
  }

  async loadPlugin(pluginId) {
    try {
      const module = await import(`/js/plugins/${pluginId}/client.js`);
      const Plugin = module.default;
      const instance = new Plugin(this);
      
      this.plugins.set(pluginId, instance);
      
      // Register hooks
      if (instance.hooks) {
        for (const [hookName, handler] of Object.entries(instance.hooks)) {
          this.registerHook(hookName, handler.bind(instance));
        }
      }
      
      // Initialize plugin
      if (instance.initialize) {
        await instance.initialize();
      }
      
      // Load styles
      if (instance.styles) {
        this.loadStyles(instance.styles);
      }
      
      console.log(`Plugin loaded: ${pluginId}`);
    } catch (error) {
      console.error(`Failed to load plugin ${pluginId}:`, error);
    }
  }

  registerHook(hookName, handler) {
    if (!this.hooks[hookName]) {
      this.hooks[hookName] = [];
    }
    this.hooks[hookName].push(handler);
  }

  async executeHook(hookName, ...args) {
    if (!this.hooks[hookName]) return [];
    
    const results = [];
    for (const handler of this.hooks[hookName]) {
      try {
        const result = await handler(...args);
        results.push(result);
      } catch (error) {
        console.error(`Hook error (${hookName}):`, error);
      }
    }
    return results;
  }

  loadStyles(styleUrl) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = styleUrl;
    document.head.appendChild(link);
  }

  // Helper method to access your existing app
  getApp() {
    return window.appGlobals || {};
  }
}

// Create global plugin system instance
window.pluginSystem = new PluginSystem();
