// User Status Plugin - Server Side
class UserStatusPlugin {
  constructor(io, app, loader) {
    this.io = io;
    this.app = app;
    this.loader = loader;
    this.userStatuses = new Map(); // socketId -> status
  }

  async initialize() {
    console.log('User Status Plugin initialized');
    
    // Set up status change endpoint
    this.io.on('connection', (socket) => {
      // Default status
      this.userStatuses.set(socket.id, 'online');
      
      socket.on('status:change', (newStatus) => {
        this.handleStatusChange(socket, newStatus);
      });
      
      socket.on('status:get-all', () => {
        socket.emit('status:all', this.getAllStatuses());
      });
    });
  }

  handleStatusChange(socket, newStatus) {
    const validStatuses = ['online', 'away', 'busy', 'invisible'];
    
    if (validStatuses.includes(newStatus)) {
      this.userStatuses.set(socket.id, newStatus);
      
      // Broadcast to all users in the same room
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      // Determine username from socket or activeUsers map
      let username = socket.username;
      if (!username && this.io.activeUsers) {
        const user = this.io.activeUsers.get(socket.id);
        if (user && user.username) {
          username = user.username;
        }
      }

      rooms.forEach(room => {
        this.io.to(room).emit('status:update', {
          userId: socket.id,
          username: username || 'Unknown',
          status: newStatus
        });
      });
    }
  }

  getAllStatuses() {
    const statuses = {};
    for (const [socketId, status] of this.userStatuses) {
      const socket = this.io.sockets.sockets.get(socketId);
      let username = socket && socket.username;
      if (!username && this.io.activeUsers) {
        const user = this.io.activeUsers.get(socketId);
        if (user && user.username) {
          username = user.username;
        }
      }
      if (username) {
        statuses[username] = status;
      }
    }
    return statuses;
  }

  // Hook: when user disconnects
  async onDisconnect(socket) {
    this.userStatuses.delete(socket.id);
  }
}

module.exports = UserStatusPlugin;
