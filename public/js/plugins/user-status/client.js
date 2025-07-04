// User Status Plugin - Client Side
export default class UserStatusClient {
  constructor(loader) {
    this.loader = loader;
    this.id = 'user-status';
    this.currentStatus = 'online';
    this.userStatuses = {};
    
    this.hooks = {
      'app-ready': this.onAppReady,
      'after-message-render': this.addStatusIndicator
    };
  }

  async initialize() {
    this.styles = '/css/plugins/user-status/styles.css';
    console.log('User Status Client Plugin initialized');
  }

  async onAppReady(app) {
    this.app = app;
    
    // Add status selector to UI
    this.createStatusSelector();
    
    // Listen for status updates
    this.app.socket.on('status:update', (data) => {
      this.userStatuses[data.username] = data.status;
      this.updateUserStatus(data.username, data.status);
    });
    
    // Get initial statuses
    this.app.socket.emit('status:get-all');
    this.app.socket.on('status:all', (statuses) => {
      this.userStatuses = statuses;
    });
  }

  createStatusSelector() {
    const selector = document.createElement('div');
    selector.id = 'status-selector';
    selector.className = 'status-selector';
    
    selector.innerHTML = `
      <div class="current-status status-${this.currentStatus}">
        <span class="status-dot"></span>
        <span class="status-text">${this.currentStatus}</span>
        <span class="dropdown-arrow">▼</span>
      </div>
      <div class="status-dropdown" style="display: none;">
        <div class="status-option" data-status="online">
          <span class="status-dot status-online"></span>
          <span>Online</span>
        </div>
        <div class="status-option" data-status="away">
          <span class="status-dot status-away"></span>
          <span>Away</span>
        </div>
        <div class="status-option" data-status="busy">
          <span class="status-dot status-busy"></span>
          <span>Busy</span>
        </div>
        <div class="status-option" data-status="invisible">
          <span class="status-dot status-invisible"></span>
          <span>Invisible</span>
        </div>
      </div>
    `;
    
    // Add to plugin container
    const container = document.getElementById('plugin-container');
    if (container) {
      container.appendChild(selector);
    }
    
    // Handle clicks
    const currentStatus = selector.querySelector('.current-status');
    const dropdown = selector.querySelector('.status-dropdown');
    
    currentStatus.onclick = () => {
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    };
    
    selector.querySelectorAll('.status-option').forEach(option => {
      option.onclick = () => {
        const newStatus = option.dataset.status;
        this.changeStatus(newStatus);
        dropdown.style.display = 'none';
      };
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!selector.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }

  changeStatus(newStatus) {
    this.currentStatus = newStatus;
    this.app.socket.emit('status:change', newStatus);
    
    // Update UI
    const selector = document.getElementById('status-selector');
    const currentDiv = selector.querySelector('.current-status');
    currentDiv.className = `current-status status-${newStatus}`;
    currentDiv.querySelector('.status-text').textContent = newStatus;
  }

  async addStatusIndicator(messageEl, message) {
    const status = this.userStatuses[message.author] || 'online';
    const meta = messageEl.querySelector('.meta');
    
    const statusIndicator = document.createElement('span');
    statusIndicator.className = `user-status-indicator status-${status}`;
    statusIndicator.title = `Status: ${status}`;
    
    // Insert after the author name
    const authorSpan = meta.querySelector('span');
    if (authorSpan) {
      authorSpan.insertAdjacentElement('afterend', statusIndicator);
    }
  }

  updateUserStatus(username, status) {
    // Update all messages from this user
    document.querySelectorAll('.message').forEach(msg => {
      const metaSpan = msg.querySelector('.meta span');
      if (metaSpan && metaSpan.textContent === username) {
        const indicator = msg.querySelector('.user-status-indicator');
        if (indicator) {
          indicator.className = `user-status-indicator status-${status}`;
          indicator.title = `Status: ${status}`;
        }
      }
    });
  }
}
