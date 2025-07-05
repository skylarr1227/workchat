document.addEventListener('DOMContentLoaded', () => {
  const USER_PW = '1';
  const ADMIN_PW = '2';
  const socket = io();
  let currentRoom = 'lobby';
  let isAdmin = false;
  let isInGameRoom = false;
  let gameData = {
    user: null,
    zoo: {},
    team: [],
    huntCooldown: 0,
    battleCooldown: 0
  };

  // DOM elements
  const app = document.getElementById('appContainer');
  const nameInput = document.getElementById('displayName');
  const colorInput = document.getElementById('displayColor');
  const passInput = document.getElementById('password');
  const enterBtn = document.getElementById('enterBtn');
  const adminControls = document.getElementById('adminControls');
  const roomTabs = document.getElementById('roomTabs');
  const userCountBtn = document.getElementById('userCountBtn');
  const messagesEl = document.getElementById('messages');
  const typingEl = document.getElementById('typingIndicator');
  const msgInput = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');
  const gamePanel = document.getElementById('gamePanel');
  const gameQuickActions = document.getElementById('gameQuickActions');
  const gameBtn = document.getElementById('gameBtn');
  const notifications = document.getElementById('notifications');

  // Game UI elements
  const cowoncyDisplay = document.getElementById('cowoncyDisplay');
  const levelDisplay = document.getElementById('levelDisplay');
  const animalsDisplay = document.getElementById('animalsDisplay');
  const lootboxDisplay = document.getElementById('lootboxDisplay');
  const huntBtn = document.getElementById('huntBtn');
  const huntAnimation = document.getElementById('huntAnimation');
  const huntProgress = document.getElementById('huntProgress');
  const huntText = document.getElementById('huntText');

  let user = { name: '', color: '' };
  let userList = [];
  let roomUserCounts = {};
  let unreadRooms = new Set();
  let isAtBottom = true;
  let editingMessageId = null;
  let currentContextMessageId = null;

  // Load saved preferences
  const savedName = localStorage.getItem('chatUsername');
  const savedColor = localStorage.getItem('chatUserColor');
  if (savedName) nameInput.value = savedName;
  if (savedColor) colorInput.value = savedColor;

  // Utility functions
  function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notifications.appendChild(notification);

    notification.onclick = () => notification.remove();
    setTimeout(() => notification.remove(), duration);
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + 
             date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  function updateGameUI() {
    if (!gameData.user) return;

    cowoncyDisplay.textContent = gameData.user.cowoncy || 0;
    levelDisplay.textContent = gameData.user.level || 1;
    animalsDisplay.textContent = Object.values(gameData.zoo).reduce((sum, count) => sum + count, 0);
    lootboxDisplay.textContent = (gameData.user.lootboxes || 0) + (gameData.user.weapon_crates || 0);
  }

  function updateRoomTabs(rooms) {
    roomTabs.innerHTML = '';

    rooms.forEach(r => {
      const tab = document.createElement('div');
      tab.className = 'room-tab' + (r === currentRoom ? ' active' : '');
      if (r === 'pocketanimals') {
        tab.className += ' pocketanimals';
      }

      const roomName = document.createElement('span');
      roomName.textContent = r === 'pocketanimals' ? '🎮 PocketAnimals' : r;
      tab.appendChild(roomName);

      if (roomUserCounts[r] !== undefined) {
        const userCount = document.createElement('span');
        userCount.className = 'user-count';
        userCount.textContent = roomUserCounts[r];
        tab.appendChild(userCount);
      }

      if (unreadRooms.has(r) && r !== currentRoom) {
        const unreadIndicator = document.createElement('span');
        unreadIndicator.className = 'unread-indicator';
        tab.appendChild(unreadIndicator);
      }

      tab.onclick = () => switchRoom(r);
      roomTabs.appendChild(tab);
    });
  }

  function switchRoom(newRoom) {
    if (newRoom === currentRoom) return;

    messagesEl.innerHTML = '';
    currentRoom = newRoom;
    unreadRooms.delete(newRoom);
    isInGameRoom = newRoom === 'pocketanimals';

    // Update UI based on room
    gamePanel.classList.toggle('active', isInGameRoom);
    gameQuickActions.classList.toggle('active', isInGameRoom);
    msgInput.classList.toggle('game-mode', isInGameRoom);

    if (isInGameRoom) {
      msgInput.placeholder = 'Type /help for game commands, or chat normally...';
      socket.emit('game get data');
    }

    msgInput.focus();
    showNotification('Connected successfully!', 'success');

    enterBtn.disabled = false;
    enterBtn.textContent = 'Enter Chat';

    document.title = `${currentRoom} - Workplace Chat`;
  });

  socket.on('rooms updated', rooms => {
    updateRoomTabs(rooms);
  });

  socket.on('room user count', ({ room, count }) => {
    roomUserCounts[room] = count;
    updateRoomTabs(Object.keys(roomUserCounts));
  });

  socket.on('user list', (users) => {
    userList = users;
    userCountBtn.querySelector('span:last-child').textContent = `Users: ${users.length}`;
  });

  socket.on('history', (msgs) => {
    messagesEl.innerHTML = '';
    msgs.forEach(m => {
      const messageDiv = createMessage(m);
      messagesEl.appendChild(messageDiv);
    });
    scrollToBottom(false);
  });

  socket.on('chat message', (m) => {
    const messageDiv = createMessage(m);
    messagesEl.appendChild(messageDiv);

    if (isAtBottom) {
      scrollToBottom();
    }

    if (m.room !== currentRoom) {
      unreadRooms.add(m.room);
      updateRoomTabs(Object.keys(roomUserCounts));
    }
  });

  // Game-specific socket events
  socket.on('game data', (data) => {
    gameData = data;
    updateGameUI();
  });

  socket.on('hunt result', (result) => {
    huntAnimation.style.display = 'none';
    huntBtn.disabled = false;

    if (result.success) {
      gameData.user = { ...gameData.user, ...result.newStats };
      updateGameUI();

      const animalNames = result.animals.map(a => a.emoji || a.name.split(' ')[0]).join(' ');
      showNotification(`🎯 Hunt successful! Caught: ${animalNames}`, 'game', 3000);

      if (result.gotLootbox) {
        showNotification('📦 Bonus lootbox obtained!', 'success', 3000);
      }
    }

    // Set cooldown
    setTimeout(() => {
      huntBtn.disabled = false;
    }, 15000);
  });

  socket.on('game message', (data) => {
    const messageDiv = createGameMessage(data);
    messagesEl.appendChild(messageDiv);

    if (isAtBottom) {
      scrollToBottom();
    }
  });

  socket.on('game error', (error) => {
    showNotification(`Game Error: ${error}`, 'error');
    huntAnimation.style.display = 'none';
    huntBtn.disabled = false;
  });

  socket.on('user joined', ({ name, isAdmin: userIsAdmin }) => {
    const systemDiv = document.createElement('div');
    systemDiv.className = 'system-message';
    systemDiv.textContent = `${name} joined the room ${userIsAdmin ? '(Admin)' : ''}`;
    messagesEl.appendChild(systemDiv);

    if (isAtBottom) {
      scrollToBottom();
    }
  });

  socket.on('user left', ({ name }) => {
    const systemDiv = document.createElement('div');
    systemDiv.className = 'system-message';
    systemDiv.textContent = `${name} left the room`;
    messagesEl.appendChild(systemDiv);

    if (isAtBottom) {
      scrollToBottom();
    }
  });

  socket.on('forced room change', ({ newRoom, reason }) => {
    currentRoom = newRoom;
    isInGameRoom = newRoom === 'pocketanimals';
    messagesEl.innerHTML = '';
    updateRoomTabs([newRoom]);
    showNotification(`Moved to ${newRoom}: ${reason}`, 'info');
    document.title = `${currentRoom} - Workplace Chat`;

    // Update UI
    gamePanel.classList.toggle('active', isInGameRoom);
    gameQuickActions.classList.toggle('active', isInGameRoom);
    msgInput.classList.toggle('game-mode', isInGameRoom);
  });

  socket.on('room created', ({ room }) => {
    showNotification(`Room "${room}" created successfully`, 'success');
  });

  socket.on('room deleted', ({ room }) => {
    showNotification(`Room "${room}" was deleted`, 'info');
  });

  socket.on('auth error', (error) => {
    showNotification(error, 'error');
    enterBtn.disabled = false;
    enterBtn.textContent = 'Enter Chat';
  });

  socket.on('disconnect', () => {
    showNotification('Disconnected from server', 'error', 10000);
    app.classList.remove('chat-open');
    enterBtn.disabled = false;
    enterBtn.textContent = 'Enter Chat';
  });

  socket.on('connect', () => {
    if (app.classList.contains('chat-open')) {
      showNotification('Reconnected to server', 'success');
      socket.emit('join room', { 
        name: user.name, 
        room: currentRoom, 
        password: passInput.value 
      });
    }
  });

  // Typing indicators
  let typing = false;
  let lastTyping = 0;
  const TYPING_DELAY = 1000;

  function updateTyping() {
    if (!typing) {
      typing = true;
      socket.emit('typing', { room: currentRoom });
    }
    lastTyping = Date.now();
    setTimeout(() => {
      if (Date.now() - lastTyping >= TYPING_DELAY && typing) {
        socket.emit('stop typing', { room: currentRoom });
        typing = false;
      }
    }, TYPING_DELAY);
  }

  msgInput.addEventListener('input', updateTyping);

  socket.on('typing', ({ typingUsers }) => {
    if (typingUsers && typingUsers.length > 0) {
      const names = typingUsers.filter(name => name !== user.name);
      if (names.length > 0) {
        let typingText = '';
        if (names.length === 1) {
          typingText = `${names[0]} is typing`;
        } else if (names.length === 2) {
          typingText = `${names[0]} and ${names[1]} are typing`;
        } else {
          typingText = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are typing`;
        }
        typingEl.innerHTML = typingText + '<span class="typing-dots"><span></span><span></span><span></span></span>';
      } else {
        typingEl.innerHTML = '';
      }
    }
  });

  socket.on('stop typing', ({ typingUsers }) => {
    if (!typingUsers || typingUsers.length === 0) {
      typingEl.innerHTML = '';
    }
  });

  // Context menu handlers
  document.addEventListener('click', (e) => {
    if (!document.getElementById('contextMenu').contains(e.target)) {
      document.getElementById('contextMenu').style.display = 'none';
    }

    // Close other modals and dropdowns
    if (!document.getElementById('emojiPicker').contains(e.target) && e.target !== document.getElementById('emojiBtn')) {
      document.getElementById('emojiPicker').style.display = 'none';
    }
    if (!gameQuickActions.contains(e.target) && e.target !== gameBtn) {
      gameQuickActions.classList.remove('active');
    }
  });

  document.getElementById('contextMenu').querySelectorAll('.reaction-item').forEach(item => {
    item.onclick = () => {
      if (currentContextMessageId) {
        socket.emit('toggle reaction', {
          messageId: currentContextMessageId,
          reaction: item.dataset.reaction,
          room: currentRoom
        });
        document.getElementById('contextMenu').style.display = 'none';
      }
    };
  });

  // Emoji picker
  document.getElementById('emojiBtn').onclick = (e) => {
    e.stopPropagation();
    const picker = document.getElementById('emojiPicker');
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
  };

  document.getElementById('emojiPicker').querySelectorAll('.emoji').forEach(emoji => {
    emoji.onclick = () => {
      msgInput.value += emoji.textContent;
      msgInput.focus();
      document.getElementById('emojiPicker').style.display = 'none';
    };
  });

  // User list modal
  userCountBtn.onclick = () => {
    const modal = document.getElementById('userListModal');
    const content = document.getElementById('userListContent');

    content.innerHTML = '';
    userList.forEach(u => {
      const userDiv = document.createElement('div');
      userDiv.style.cssText = 'display:flex; align-items:center; gap:12px; padding:8px; border-radius:4px; transition:background-color 0.2s; cursor:pointer;';
      userDiv.innerHTML = `
        <div style="width:12px; height:12px; border-radius:50%; background-color:${u.color}; border:1px solid #555;"></div>
        <div style="flex:1; font-weight:500; color:#fff;">${u.name}</div>
        ${u.isAdmin ? '<div style="background:#f04747; color:#fff; padding:2px 6px; border-radius:3px; font-size:0.7rem; font-weight:bold;">Admin</div>' : ''}
      `;

      userDiv.onclick = () => {
        if (u.name !== user.name) {
          msgInput.value += `@${u.name} `;
          msgInput.focus();
          modal.style.display = 'none';
        }
      };

      userDiv.onmouseover = () => {
        userDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
      };

      userDiv.onmouseout = () => {
        userDiv.style.backgroundColor = '';
      };

      content.appendChild(userDiv);
    });

    modal.style.display = 'block';
  };

  // Modal close handlers
  document.querySelectorAll('.modal').forEach(modal => {
    modal.onclick = (e) => {
      if (e.target === modal || e.target.classList.contains('close-btn')) {
        modal.style.display = 'none';
      }
    };
  });

  // File upload
  document.getElementById('fileBtn').onclick = () => {
    document.getElementById('fileInput').click();
  };

  document.getElementById('fileInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      showNotification('File too large (max 10MB)', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('room', currentRoom);
    formData.append('author', user.name);

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();

      socket.emit('chat message', {
        name: user.name,
        text: msgInput.value.trim() || `Uploaded ${file.name}`,
        color: user.color,
        room: currentRoom,
        file: result.file
      });

      msgInput.value = '';
      document.getElementById('fileInput').value = '';
    } catch (error) {
      showNotification('Failed to upload file', 'error');
    }
  };

  // Markdown help
  document.getElementById('markdownBtn').onclick = () => {
    document.getElementById('markdownHelp').style.display = 'block';
  };

  // Scroll detection
  messagesEl.addEventListener('scroll', () => {
    const threshold = 50;
    isAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
    document.getElementById('scrollToBottom').style.display = isAtBottom ? 'none' : 'block';
  });

  document.getElementById('scrollToBottom').onclick = () => {
    scrollToBottom();
  };

  // Color change
  colorInput.addEventListener('change', () => {
    user.color = colorInput.value;
    localStorage.setItem('chatUserColor', user.color);
    if (app.classList.contains('chat-open')) {
      socket.emit('set color', { color: user.color });
    }
  });

  // Additional socket events for reactions, editing, etc.
  socket.on('reaction updated', ({ messageId, reaction, users }) => {
    // Handle reaction updates if needed
  });

  socket.on('message edited', ({ messageId, newText }) => {
    const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageDiv) {
      const textDiv = messageDiv.querySelector('.text');
      textDiv.innerHTML = processMessageText(newText);

      const metaDiv = messageDiv.querySelector('.meta');
      if (!metaDiv.querySelector('.edited')) {
        const editedSpan = document.createElement('span');
        editedSpan.className = 'edited';
        editedSpan.textContent = '(edited)';
        metaDiv.appendChild(editedSpan);
      }
    }
  });

  socket.on('message deleted', ({ messageId }) => {
    const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageDiv) {
      messageDiv.remove();
    }
  });

  // Admin functions
  if (adminControls) {
    document.getElementById('createRoomBtn').onclick = () => {
      const name = document.getElementById('newRoomName').value.trim();
      if (!name) {
        showNotification('Enter a room name', 'error');
        return;
      }

      socket.emit('create room', { 
        room: name, 
        adminPassword: passInput.value 
      });
      document.getElementById('newRoomName').value = '';
    };

    document.getElementById('deleteRoomBtn').onclick = () => {
      const roomToDelete = document.getElementById('roomDeleteSelect').value;
      if (!roomToDelete) {
        showNotification('Select a room to delete', 'error');
        return;
      }

      if (confirm(`Delete room "${roomToDelete}"?`)) {
        socket.emit('delete room', {
          room: roomToDelete,
          adminPassword: passInput.value
        });
      }
    };

    document.getElementById('roomStatsBtn').onclick = () => {
      socket.emit('get room stats');
    };

    socket.on('room stats', (stats) => {
      let statsHtml = '<h3>Room Statistics</h3>';
      stats.forEach(room => {
        statsHtml += `
          <div style="margin-bottom: 12px; padding: 8px; background: #40444b; border-radius: 4px;">
            <strong>${room.name}</strong><br>
            Users: ${room.userCount} | Messages: ${room.messageCount}
          </div>
        `;
      });

      const statsModal = document.createElement('div');
      statsModal.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: #36393f; padding: 20px; border-radius: 8px; max-width: 400px;
        max-height: 70vh; overflow-y: auto; z-index: 1001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5); color: #fff;
      `;
      statsModal.innerHTML = statsHtml + '<button onclick="this.parentElement.remove()" style="margin-top: 12px; padding: 8px 16px; background: #7289da; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>';

      document.body.appendChild(statsModal);
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      userCountBtn.click();
    }

    if (e.key === 'Escape') {
      document.getElementById('userListModal').style.display = 'none';
      document.getElementById('fileManagerModal').style.display = 'none';
      document.getElementById('markdownHelp').style.display = 'none';
      document.getElementById('emojiPicker').style.display = 'none';
      document.getElementById('contextMenu').style.display = 'none';
      document.getElementById('imageLightbox').style.display = 'none';
      gameQuickActions.classList.remove('active');
    }
  });

  // Initialize
  fetch('/rooms')
    .then(res => res.json())
    .then(data => updateRoomTabs(data.rooms));

  // Handle Enter key in login
  nameInput.addEventListener('keyup', e => { if (e.key === 'Enter') passInput.focus(); });
  passInput.addEventListener('keyup', e => { if (e.key === 'Enter') enterBtn.click(); });

  // Page visibility API
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      socket.emit('inactive');
    } else {
      socket.emit('active');
      unreadRooms.delete(currentRoom);
      updateRoomTabs(Object.keys(roomUserCounts));
    }
  });

  // Prevent accidental page close
  window.addEventListener('beforeunload', (e) => {
    if (app.classList.contains('chat-open')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Image lightbox
  document.addEventListener('click', (e) => {
    if (e.target.closest('.file-link.image-file')) {
      e.preventDefault();
      const link = e.target.closest('.file-link');
      const imgSrc = link.href;
      const lightbox = document.getElementById('imageLightbox');
      lightbox.querySelector('img').src = imgSrc;
      lightbox.style.display = 'block';
    }
  });

  document.getElementById('imageLightbox').onclick = (e) => {
    if (e.target === document.getElementById('imageLightbox') || e.target.tagName === 'BUTTON') {
      document.getElementById('imageLightbox').style.display = 'none';
    }
  };

  // ========== PLUGIN SYSTEM INTEGRATION ==========
  // Export globals for plugins to use
  window.appGlobals = {
    socket: socket,
    currentRoom: currentRoom,
    user: user,
    isAdmin: isAdmin,
    showNotification: showNotification,
    sendMessage: sendMessage,
    switchRoom: switchRoom,
    formatTime: formatTime,
    processMessageText: processMessageText,
    scrollToBottom: scrollToBottom,
    userList: userList,
    messagesEl: messagesEl,
    msgInput: msgInput
  };

  // Update globals when they change
  function updateGlobals() {
    window.appGlobals.currentRoom = currentRoom;
    window.appGlobals.user = user;
    window.appGlobals.isAdmin = isAdmin;
    window.appGlobals.userList = userList;
  }

  // Initialize plugin system after connection
  socket.on('connect', async () => {
    if (window.pluginSystem) {
      await window.pluginSystem.initialize();
      await window.pluginSystem.executeHook('app-ready', window.appGlobals);
    }
  });

  // Plugin hook: before sending message
  const originalSendMessage = sendMessage;
  sendMessage = async function() {
    const text = msgInput.value.trim();
    if (!text) return;

    // Execute plugin hook
    if (window.pluginSystem) {
      const hookResults = await window.pluginSystem.executeHook('before-send', { text, room: currentRoom });
      if (hookResults.some(r => r?.cancel)) return;
      
      const modifiedText = hookResults.reduce((t, r) => r?.text || t, text);
      msgInput.value = modifiedText;
    }

    originalSendMessage();

    // Execute after-send hook
    if (window.pluginSystem) {
      await window.pluginSystem.executeHook('after-send', { text, room: currentRoom });
    }
  };

  // Plugin hook: after message render
  const originalCreateMessage = createMessage;
  createMessage = function(msgObj) {
    const messageDiv = originalCreateMessage(msgObj);
    
    // Execute plugin hook
    if (window.pluginSystem) {
      window.pluginSystem.executeHook('after-message-render', messageDiv, msgObj);
    }
    
    return messageDiv;
  };

  // Plugin hook: room switch
  const originalSwitchRoom = switchRoom;
  switchRoom = async function(newRoom) {
    if (window.pluginSystem) {
      const hookResults = await window.pluginSystem.executeHook('before-room-switch', currentRoom, newRoom);
      if (hookResults.some(r => r?.cancel)) return;
    }

    originalSwitchRoom(newRoom);
    updateGlobals();

    if (window.pluginSystem) {
      await window.pluginSystem.executeHook('after-room-switch', newRoom);
    }
  };

  // Override socket.on for user list to add plugin hook
  const originalUserListHandler = socket._callbacks['$user list'] ? socket._callbacks['$user list'][0] : null;
  socket.off('user list');
  socket.on('user list', (users) => {
    userList = users;
    userCountBtn.querySelector('span:last-child').textContent = `Users: ${users.length}`;
    updateGlobals();
    
    if (window.pluginSystem) {
      window.pluginSystem.executeHook('user-list-update', users);
    }
  });

  // Override socket.on for login success to add plugin hook
  const originalLoginHandler = socket._callbacks['$login success'] ? socket._callbacks['$login success'][0] : null;
  socket.off('login success');
  socket.on('login success', async (data) => {
    // Call original handler
    isAdmin = data.isAdmin;
    currentRoom = data.room;
    isInGameRoom = data.room === 'pocketanimals';
    app.classList.add('chat-open');

    if (isAdmin) {
      adminControls.style.display = 'block';
    }

    // Update UI for game room
    gamePanel.classList.toggle('active', isInGameRoom);
    gameQuickActions.classList.toggle('active', isInGameRoom);
    msgInput.classList.toggle('game-mode', isInGameRoom);

    if (isInGameRoom) {
      msgInput.placeholder = 'Type /help for game commands, or chat normally...';
      socket.emit('game get data');
    }

    msgInput.focus();
    showNotification('Connected successfully!', 'success');

    enterBtn.disabled = false;
    enterBtn.textContent = 'Enter Chat';

    document.title = `${currentRoom} - Workplace Chat`;
    
    updateGlobals();
    
    if (window.pluginSystem) {
      await window.pluginSystem.executeHook('login-success', data);
    }
  });


    document.getElementById('roomStatsBtn').onclick = () => {
      socket.emit('get room stats');
    };

    socket.on('room stats', (stats) => {
      let statsHtml = '<h3>Room Statistics</h3>';
      stats.forEach(room => {
        statsHtml += `
          <div style="margin-bottom: 12px; padding: 8px; background: #40444b; border-radius: 4px;">
            <strong>${room.name}</strong><br>
            Users: ${room.userCount} | Messages: ${room.messageCount}
          </div>
        `;
      });

      const statsModal = document.createElement('div');
      statsModal.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: #36393f; padding: 20px; border-radius: 8px; max-width: 400px;
        max-height: 70vh; overflow-y: auto; z-index: 1001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5); color: #fff;
      `;
      statsModal.innerHTML = statsHtml + '<button onclick="this.parentElement.remove()" style="margin-top: 12px; padding: 8px 16px; background: #7289da; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>';

      document.body.appendChild(statsModal);
    });
  

   // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      userCountBtn.click();
    }

    if (e.key === 'Escape') {
      document.getElementById('userListModal').style.display = 'none';
      document.getElementById('fileManagerModal').style.display = 'none';
      document.getElementById('markdownHelp').style.display = 'none';
      document.getElementById('emojiPicker').style.display = 'none';
      document.getElementById('contextMenu').style.display = 'none';
      document.getElementById('imageLightbox').style.display = 'none';
      gameQuickActions.classList.remove('active');
    }
  });

  // Initialize
  fetch('/rooms')
    .then(res => res.json())
    .then(data => updateRoomTabs(data.rooms));

  // Handle Enter key in login
  nameInput.addEventListener('keyup', e => { if (e.key === 'Enter') passInput.focus(); });
  passInput.addEventListener('keyup', e => { if (e.key === 'Enter') enterBtn.click(); });

  // Page visibility API
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      socket.emit('inactive');
    } else {
      socket.emit('active');
      unreadRooms.delete(currentRoom);
      updateRoomTabs(Object.keys(roomUserCounts));
    }
  });

  // Prevent accidental page close
  window.addEventListener('beforeunload', (e) => {
    if (app.classList.contains('chat-open')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Image lightbox
  document.addEventListener('click', (e) => {
    if (e.target.closest('.file-link.image-file')) {
      e.preventDefault();
      const link = e.target.closest('.file-link');
      const imgSrc = link.href;
      const lightbox = document.getElementById('imageLightbox');
      lightbox.querySelector('img').src = imgSrc;
      lightbox.style.display = 'block';
    }
  });

  document.getElementById('imageLightbox').onclick = (e) => {
    if (e.target === document.getElementById('imageLightbox') || e.target.tagName === 'BUTTON') {
      document.getElementById('imageLightbox').style.display = 'none';
    }
  };

  // ========== PLUGIN SYSTEM INTEGRATION ==========
  // Export globals for plugins to use
  window.appGlobals = {
    socket: socket,
    currentRoom: currentRoom,
    user: user,
    isAdmin: isAdmin,
    showNotification: showNotification,
    sendMessage: sendMessage,
    switchRoom: switchRoom,
    formatTime: formatTime,
    processMessageText: processMessageText,
    scrollToBottom: scrollToBottom,
    userList: userList,
    messagesEl: messagesEl,
    msgInput: msgInput
  };

  // Update globals when they change
  function updateGlobals() {
    window.appGlobals.currentRoom = currentRoom;
    window.appGlobals.user = user;
    window.appGlobals.isAdmin = isAdmin;
    window.appGlobals.userList = userList;
  }

  // Initialize plugin system after connection
  socket.on('connect', async () => {
    if (window.pluginSystem) {
      await window.pluginSystem.initialize();
      await window.pluginSystem.executeHook('app-ready', window.appGlobals);
    }
  });

  // Plugin hook: before sending message
  const originalSendMessage = sendMessage;
  sendMessage = async function() {
    const text = msgInput.value.trim();
    if (!text) return;

    // Execute plugin hook
    if (window.pluginSystem) {
      const hookResults = await window.pluginSystem.executeHook('before-send', { text, room: currentRoom });
      if (hookResults.some(r => r?.cancel)) return;
      
      const modifiedText = hookResults.reduce((t, r) => r?.text || t, text);
      msgInput.value = modifiedText;
    }

    originalSendMessage();

    // Execute after-send hook
    if (window.pluginSystem) {
      await window.pluginSystem.executeHook('after-send', { text, room: currentRoom });
    }
  };

  // Plugin hook: after message render
  const originalCreateMessage = createMessage;
  createMessage = function(msgObj) {
    const messageDiv = originalCreateMessage(msgObj);
    
    // Execute plugin hook
    if (window.pluginSystem) {
      window.pluginSystem.executeHook('after-message-render', messageDiv, msgObj);
    }
    
    return messageDiv;
  };

  // Plugin hook: room switch
  const originalSwitchRoom = switchRoom;
  switchRoom = async function(newRoom) {
    if (window.pluginSystem) {
      const hookResults = await window.pluginSystem.executeHook('before-room-switch', currentRoom, newRoom);
      if (hookResults.some(r => r?.cancel)) return;
    }

    originalSwitchRoom(newRoom);
    updateGlobals();

    if (window.pluginSystem) {
      await window.pluginSystem.executeHook('after-room-switch', newRoom);
    }
  };

  // Override socket.on for user list to add plugin hook
  const originalUserListHandler = socket._callbacks['$user list'] ? socket._callbacks['$user list'][0] : null;
  socket.off('user list');
  socket.on('user list', (users) => {
    userList = users;
    userCountBtn.querySelector('span:last-child').textContent = `Users: ${users.length}`;
    updateGlobals();
    
    if (window.pluginSystem) {
      window.pluginSystem.executeHook('user-list-update', users);
    }
  });

  // Override socket.on for login success to add plugin hook
  const originalLoginHandler = socket._callbacks['$login success'] ? socket._callbacks['$login success'][0] : null;
  socket.off('login success');
  socket.on('login success', async (data) => {
    // Call original handler
    isAdmin = data.isAdmin;
    currentRoom = data.room;
    isInGameRoom = data.room === 'pocketanimals';
    app.classList.add('chat-open');

    if (isAdmin) {
      adminControls.style.display = 'block';
    }

    // Update UI for game room
    gamePanel.classList.toggle('active', isInGameRoom);
    gameQuickActions.classList.toggle('active', isInGameRoom);
    msgInput.classList.toggle('game-mode', isInGameRoom);

    if (isInGameRoom) {
      msgInput.placeholder = 'Type /help for game commands, or chat normally...';
      socket.emit('game get data');
    }

    msgInput.focus();
    showNotification('Connected successfully!', 'success');

    enterBtn.disabled = false;
    enterBtn.textContent = 'Enter Chat';

    document.title = `${currentRoom} - Workplace Chat`;
    
    updateGlobals();
    
    if (window.pluginSystem) {
      await window.pluginSystem.executeHook('login-success', data);
    }
  });

});
