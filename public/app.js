/**
 * CampusConnect - Client-Side Chat Application
 * Tech Stack: Vanilla JS, Firebase Web SDK v10 (Compat), Socket.IO Client, Tailwind CSS
 */

// ==================================================================
// 1. FIREBASE WEB CONFIGURATION
// ==================================================================
// Configured with provisioned Google Cloud/Firebase project credentials
let FIREBASE_CONFIG = {
  projectId: "gen-lang-client-0577531491",
  appId: "1:514319211789:web:96b91508ddde13117ca444",
  apiKey: "AIzaSyAqZSSl6htsmB0ziFkV0EsHYq2s-z5XMAs",
  authDomain: "gen-lang-client-0577531491.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-campusconnectrea-757c0d50-38de-4e24-a364-dc601baa4c07",
  storageBucket: "gen-lang-client-0577531491.firebasestorage.app",
  messagingSenderId: "514319211789",
  measurementId: "",
  oAuthClientId: "514319211789-0jpv787fv406lup907g0a97flhk74slg.apps.googleusercontent.com",
  recaptchaSiteKey: ""
};

// ==================================================================
// 2. STATE MANAGEMENT
// ==================================================================
const state = {
  authMode: 'signin', // 'signin' | 'register'
  currentUser: null,  // { uid, displayName, email, photoURL }
  currentRoom: 'general',
  isDirectMessage: false,
  dmTargetUser: null,
  activeDirectMessages: new Map(), // targetUid -> { uid, name, email, picture, status, unreadCount, lastMessage }
  messages: [],       // Current room's active messages
  socket: null,
  isFirebaseActive: false,
  isTyping: false,
  typingTimeout: null,
  activeTypers: new Set(),
  unreadCounts: {
    'general': 0,
    'homework-help': 0,
    'gaming': 0,
    'hangouts': 0,
    'events': 0
  },
  channels: [
    { id: 'general', name: '#general', topic: 'Campus life, casual chats & announcements' },
    { id: 'homework-help', name: '#homework-help', topic: 'Math, Science, History & study group Q&A' },
    { id: 'gaming', name: '#gaming', topic: 'Esports, Valorant, Minecraft & Discord hangouts' },
    { id: 'hangouts', name: '#hangouts', topic: 'Weekend plans, lunch meetups & campus chill' },
    { id: 'events', name: '#events', topic: 'School rallies, hackathons, sports & club meetings' }
  ],
  emojiCategories: {
    smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😛', '😜', '🤪', '😎', '🥳', '😏', '🤔', '🤫', '🤭', '🥱', '😴', '😌', '🤤', '😷', '🤯', '😭', '😱', '🥺'],
    school: ['📚', '📖', '📕', '📗', '📘', '📙', '📓', '📒', '📝', '✏️', '✒️', '🎒', '📐', '📏', '🔬', '🔭', '💻', '🖥️', '⌨️', '🧠', '💡', '🎓', '🎯', '💯', '🧪', '🧬', '📊', '📈', '📌', '📎'],
    fun: ['🎮', '🕹️', '👾', '🍕', '🍔', '🍟', '🥪', '☕', '🥤', '🍿', '🎵', '🎶', '🎧', '🎸', '🛹', '🏀', '⚽', '🏆', '🥇', '🎨', '🚀', '⚡', '✨', '🎉', '🎊', '🔥', '💫', '🌟'],
    hands: ['👍', '👎', '👏', '🙌', '👐', '🤲', '🤝', '✌️', '🤞', '🤟', '🤘', '👊', '🤛', '🤜', '🫡', '👋', '🫶', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '💯', '⭐', '✨']
  },

  // Camera & Image Sharing State
  cameraStream: null,
  cameraFacingMode: 'user', // 'user' | 'environment'
  stagedImage: null,        // Base64 dataUrl ready to be sent with message
  capturedSnapshot: null,   // Freeze frame in camera modal

  // Color Theme State
  currentTheme: localStorage.getItem('campusconnect_theme') || 'midnight'
};

// DOM Element references
const dom = {
  authView: document.getElementById('auth-view'),
  chatView: document.getElementById('chat-view'),
  tabSignIn: document.getElementById('tab-signin-btn'),
  tabRegister: document.getElementById('tab-register-btn'),
  fieldName: document.getElementById('field-name'),
  inputName: document.getElementById('input-name'),
  inputEmail: document.getElementById('input-email'),
  inputPassword: document.getElementById('input-password'),
  emailError: document.getElementById('email-error'),
  passwordError: document.getElementById('password-error'),
  authForm: document.getElementById('auth-form'),
  btnSubmitAuth: document.getElementById('btn-submit-auth'),
  submitButtonText: document.getElementById('submit-button-text'),
  authSpinner: document.getElementById('auth-spinner'),
  authErrorAlert: document.getElementById('auth-error-alert'),
  authErrorText: document.getElementById('auth-error-text'),
  btnGoogleAuth: document.getElementById('btn-google-auth'),
  demoLoginButtons: document.querySelectorAll('.btn-demo-login'),
  
  // Chat Workspace Elements
  serverDot: document.getElementById('server-connection-dot'),
  serverText: document.getElementById('server-connection-text'),
  channelsList: document.getElementById('channels-list'),
  dmUsersList: document.getElementById('dm-users-list'),
  dmActiveCount: document.getElementById('dm-active-count'),
  dmEmptyHint: document.getElementById('dm-empty-hint'),
  onlineUsersList: document.getElementById('online-users-list'),
  onlineUsersCount: document.getElementById('online-users-count'),
  
  // Profile bar
  myAvatar: document.getElementById('my-avatar'),
  myDisplayName: document.getElementById('my-display-name'),
  myStatusIndicator: document.getElementById('my-status-indicator'),
  statusSelector: document.getElementById('status-selector'),
  btnLogout: document.getElementById('btn-logout'),
  
  // Chat Window & Header
  channelIconContainer: document.getElementById('channel-icon-container'),
  channelIconSymbol: document.getElementById('channel-icon-symbol'),
  dmHeaderAvatar: document.getElementById('dm-header-avatar'),
  btnBackToChannels: document.getElementById('btn-back-to-channels'),
  currentChannelTitle: document.getElementById('current-channel-title'),
  currentChannelTopic: document.getElementById('current-channel-topic'),
  channelOccupantsBadge: document.getElementById('channel-occupants-badge'),
  messagesContainer: document.getElementById('messages-container'),
  typingBanner: document.getElementById('typing-banner'),
  typingContent: document.getElementById('typing-content'),
  typingText: document.getElementById('typing-text'),
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  btnSendMessage: document.getElementById('btn-send-message'),
  quickEmojis: document.querySelectorAll('.quick-emoji'),

  // Rich Text Formatting & Emoji Picker
  btnFormatBold: document.getElementById('btn-format-bold'),
  btnFormatItalic: document.getElementById('btn-format-italic'),
  btnFormatStrike: document.getElementById('btn-format-strike'),
  btnFormatCode: document.getElementById('btn-format-code'),
  btnToggleEmojiPicker: document.getElementById('btn-toggle-emoji-picker'),
  emojiPickerPopover: document.getElementById('emoji-picker-popover'),
  emojiPickerGrid: document.getElementById('emoji-picker-grid'),
  emojiCatTabs: document.querySelectorAll('.emoji-cat-tab'),

  // Config Guide Modal
  modalConfig: document.getElementById('modal-config'),
  btnOpenConfigGuide: document.getElementById('btn-open-config-guide'),
  btnOpenSettings: document.getElementById('btn-open-settings'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnModalDismiss: document.getElementById('btn-modal-dismiss'),

  // Theme & Appearance Elements
  themeSelector: document.getElementById('theme-selector'),
  themeOptionBtns: document.querySelectorAll('.theme-option-btn'),
  btnQuickThemeToggle: document.getElementById('btn-quick-theme-toggle'),
  currentThemeIcon: document.getElementById('current-theme-icon'),
  currentThemeName: document.getElementById('current-theme-name'),

  // Camera & Image Capture
  btnOpenCamera: document.getElementById('btn-open-camera'),
  stagedPhotoPreview: document.getElementById('staged-photo-preview'),
  stagedPhotoImg: document.getElementById('staged-photo-img'),
  btnStagedImgThumbnail: document.getElementById('btn-staged-img-thumbnail'),
  btnPreviewStagedPhoto: document.getElementById('btn-preview-staged-photo'),
  btnDiscardStagedPhoto: document.getElementById('btn-discard-staged-photo'),

  modalCamera: document.getElementById('modal-camera'),
  btnCloseCamera: document.getElementById('btn-close-camera'),
  cameraModalTitle: document.getElementById('camera-modal-title'),
  cameraVideo: document.getElementById('camera-video'),
  cameraCanvas: document.getElementById('camera-canvas'),
  cameraPreviewImg: document.getElementById('camera-preview-img'),
  cameraLoadingState: document.getElementById('camera-loading-state'),
  cameraErrorState: document.getElementById('camera-error-state'),
  cameraErrorMessage: document.getElementById('camera-error-message'),
  btnRetryCamera: document.getElementById('btn-retry-camera'),
  cameraFallbackFile: document.getElementById('camera-fallback-file'),
  btnFlipCamera: document.getElementById('btn-flip-camera'),
  cameraFlash: document.getElementById('camera-flash'),
  cameraLiveControls: document.getElementById('camera-live-controls'),
  cameraPreviewControls: document.getElementById('camera-preview-controls'),
  cameraAltUpload: document.getElementById('camera-alt-upload'),
  btnSnapPhoto: document.getElementById('btn-snap-photo'),
  cameraCaptionInput: document.getElementById('camera-caption-input'),
  btnRetakePhoto: document.getElementById('btn-retake-photo'),
  btnAttachPhoto: document.getElementById('btn-attach-photo'),
  btnSendPhotoNow: document.getElementById('btn-send-photo-now'),

  // Image Lightbox
  modalImageLightbox: document.getElementById('modal-image-lightbox'),
  lightboxImage: document.getElementById('lightbox-image'),
  lightboxCaption: document.getElementById('lightbox-caption'),
  lightboxDownloadLink: document.getElementById('lightbox-download-link'),
  btnCloseLightbox: document.getElementById('btn-close-lightbox')
};

// ==================================================================
// 3. FIREBASE CLIENT INITIALIZATION & ERROR HANDLING
// ==================================================================
const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write'
};

function handleFirestoreError(error, operationType, path) {
  const currentUser = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid || null,
      email: currentUser?.email || null,
      emailVerified: currentUser?.emailVerified || null,
      isAnonymous: currentUser?.isAnonymous || null,
      tenantId: currentUser?.tenantId || null,
      providerInfo: currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testFirestoreConnection() {
  if (typeof window.initModularFirestore === 'function') {
    window.initModularFirestore(FIREBASE_CONFIG);
  }
}

async function initializeFirebase() {
  try {
    const res = await fetch('/api/firebase-config');
    if (res.ok) {
      const liveConfig = await res.json();
      if (liveConfig && liveConfig.apiKey) {
        FIREBASE_CONFIG = { ...FIREBASE_CONFIG, ...liveConfig };
      }
    }
  } catch (err) {
    console.debug('Using bundled Firebase config.');
  }

  const isConfigured = FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.includes('YOUR_');
  
  if (isConfigured && typeof firebase !== 'undefined') {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      state.isFirebaseActive = true;
      console.log('🔥 Firebase client initialized successfully with project:', FIREBASE_CONFIG.projectId);

      // Verify connection to Firestore as mandated
      testFirestoreConnection();

      // Listen for Firebase Auth State Changes
      firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
          console.log('👤 Firebase Auth User detected:', user.email);
          const profile = {
            uid: user.uid,
            displayName: user.displayName || user.email.split('@')[0],
            email: user.email,
            photoURL: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'Student')}&background=4f46e5&color=fff`
          };
          const idToken = await user.getIdToken();
          handleUserLoggedIn(profile, idToken);
        } else {
          handleUserLoggedOut();
        }
      });
    } catch (err) {
      console.warn('⚠️ Firebase initialization failed:', err.message);
      state.isFirebaseActive = false;
    }
  } else {
    console.info('ℹ️ Operating in Sandbox/Demo mode.');
  }
}

// ==================================================================
// 4. AUTHENTICATION INTERACTIONS & VALIDATIONS
// ==================================================================

// Toggle between Sign In & Register views
function setAuthMode(mode) {
  state.authMode = mode;
  hideAuthErrors();

  if (mode === 'signin') {
    dom.tabSignIn.classList.add('bg-indigo-600', 'text-white', 'shadow-sm');
    dom.tabSignIn.classList.remove('text-slate-400');
    dom.tabRegister.classList.remove('bg-indigo-600', 'text-white', 'shadow-sm');
    dom.tabRegister.classList.add('text-slate-400');
    dom.fieldName.classList.add('hidden');
    dom.submitButtonText.textContent = 'Sign In';
  } else {
    dom.tabRegister.classList.add('bg-indigo-600', 'text-white', 'shadow-sm');
    dom.tabRegister.classList.remove('text-slate-400');
    dom.tabSignIn.classList.remove('bg-indigo-600', 'text-white', 'shadow-sm');
    dom.tabSignIn.classList.add('text-slate-400');
    dom.fieldName.classList.remove('hidden');
    dom.submitButtonText.textContent = 'Create Account';
  }
}

function showAuthError(message) {
  dom.authErrorAlert.classList.remove('hidden');
  dom.authErrorText.textContent = message;
  dom.authSpinner.classList.add('hidden');
  dom.btnSubmitAuth.disabled = false;
}

function hideAuthErrors() {
  dom.authErrorAlert.classList.add('hidden');
  dom.emailError.classList.add('hidden');
  dom.passwordError.classList.add('hidden');
}

// Input validation
function validateAuthInputs(email, password, name = '') {
  let isValid = true;
  hideAuthErrors();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email.trim())) {
    dom.emailError.textContent = 'Please enter a valid school email address.';
    dom.emailError.classList.remove('hidden');
    isValid = false;
  }

  if (!password || password.length < 6) {
    dom.passwordError.textContent = 'Password must be at least 6 characters.';
    dom.passwordError.classList.remove('hidden');
    isValid = false;
  }

  if (state.authMode === 'register' && (!name || name.trim().length < 2)) {
    showAuthError('Please enter your full name (minimum 2 characters).');
    isValid = false;
  }

  return isValid;
}

// Handle Form Submission (Email/Password)
async function handleEmailPasswordAuth() {
  const email = dom.inputEmail.value.trim();
  const password = dom.inputPassword.value;
  const name = dom.inputName.value.trim();

  if (!validateAuthInputs(email, password, name)) return;

  dom.authSpinner.classList.remove('hidden');
  dom.btnSubmitAuth.disabled = true;

  if (state.isFirebaseActive) {
    try {
      if (state.authMode === 'signin') {
        await firebase.auth().signInWithEmailAndPassword(email, password);
      } else {
        const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'Student')}&background=6366f1&color=fff`;
        await cred.user.updateProfile({
          displayName: name,
          photoURL: avatarUrl
        });
        // Force refresh user profile
        const refreshedUser = firebase.auth().currentUser;
        const idToken = await refreshedUser.getIdToken();
        handleUserLoggedIn({
          uid: refreshedUser.uid,
          displayName: name,
          email: refreshedUser.email,
          photoURL: avatarUrl
        }, idToken);
      }
    } catch (err) {
      console.error('Firebase Auth error:', err);
      let userFriendlyMsg = err.message;
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        userFriendlyMsg = 'Invalid email or password. Please try again.';
      } else if (err.code === 'auth/email-already-in-use') {
        userFriendlyMsg = 'This email is already registered. Please sign in instead.';
      }
      showAuthError(userFriendlyMsg);
    } finally {
      dom.authSpinner.classList.add('hidden');
      dom.btnSubmitAuth.disabled = false;
    }
  } else {
    // Sandbox / Dev Mode Mock Login
    setTimeout(() => {
      const displayName = name || email.split('@')[0];
      const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=4f46e5&color=fff`;
      const mockProfile = {
        uid: `student_${btoa(email).substring(0, 10)}`,
        displayName: displayName,
        email: email,
        photoURL: avatarUrl
      };
      const mockToken = `demo-token-${mockProfile.uid}`;
      handleUserLoggedIn(mockProfile, mockToken);
      dom.authSpinner.classList.add('hidden');
      dom.btnSubmitAuth.disabled = false;
    }, 400);
  }
}

// Google Sign-In
async function handleGoogleSignIn() {
  if (state.isFirebaseActive) {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
    } catch (err) {
      console.error('Google Sign In error:', err);
      showAuthError(`Google Sign-In: ${err.message}`);
    }
  } else {
    // Sandbox Google Login simulation
    const mockProfile = {
      uid: `google_student_${Math.random().toString(36).substring(2, 8)}`,
      displayName: 'Alex Rivera (Google)',
      email: 'alex.rivera@school.edu',
      photoURL: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'
    };
    handleUserLoggedIn(mockProfile, `demo-token-${mockProfile.uid}`);
  }
}

// Quick Student Demo Login
function handleDemoLogin(name, email) {
  const avatars = {
    'Alex Rivera': 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    'Maya Chen': 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80',
    'Jordan Smith': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80'
  };

  const profile = {
    uid: `demo_${email.replace(/[@.]/g, '_')}`,
    displayName: name,
    email: email,
    photoURL: avatars[name] || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=fff`
  };

  handleUserLoggedIn(profile, `demo-token-${profile.uid}`);
}

// ==================================================================
// 5. USER SESSION TRANSITIONS (AUTH <-> CHAT WORKSPACE)
// ==================================================================
function handleUserLoggedIn(userProfile, token) {
  state.currentUser = userProfile;

  // Update Profile Sidebar UI
  dom.myAvatar.src = userProfile.photoURL;
  dom.myDisplayName.textContent = userProfile.displayName;

  // Switch Views
  dom.authView.classList.add('hidden');
  dom.chatView.classList.remove('hidden');

  // Render initial channel tabs
  renderChannelsList();

  // Initialize Socket.IO connection
  connectSocket(token, userProfile);
}

function handleUserLoggedOut() {
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  state.currentUser = null;
  state.currentRoom = 'general';
  
  dom.chatView.classList.add('hidden');
  dom.authView.classList.remove('hidden');
  dom.messagesContainer.innerHTML = '';
}

// ==================================================================
// 6. SOCKET.IO REAL-TIME CLIENT LOGIC
// ==================================================================
function connectSocket(token, userProfile) {
  if (state.socket) {
    state.socket.disconnect();
  }

  dom.serverDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
  dom.serverText.textContent = 'Connecting...';

  // Instantiate Socket.IO client passing token in auth payload
  state.socket = io({
    auth: {
      token: token,
      user: {
        uid: userProfile.uid,
        name: userProfile.displayName,
        email: userProfile.email,
        picture: userProfile.photoURL
      }
    }
  });

  // Connection established
  state.socket.on('connect', () => {
    console.log('✅ Socket.IO connected with socket id:', state.socket.id);
    dom.serverDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    dom.serverText.textContent = 'Live Connected';
    // Join current room on initial connect
    state.socket.emit('user:join_room', { roomId: state.currentRoom });
  });

  // Connection error
  state.socket.on('connect_error', (error) => {
    console.error('Socket.IO connect error:', error.message);
    dom.serverDot.className = 'w-2 h-2 rounded-full bg-rose-500';
    dom.serverText.textContent = 'Auth / Conn Error';
  });

  // Disconnection
  state.socket.on('disconnect', (reason) => {
    console.warn('Socket.IO disconnected:', reason);
    dom.serverDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
    dom.serverText.textContent = 'Reconnecting...';
  });

  // Room Message History received
  state.socket.on('room:history', (data) => {
    if (data.roomId === state.currentRoom) {
      state.messages = data.messages || [];
      renderMessagesList(state.messages);
      checkAndMarkMessagesRead();
    }
  });

  // Incoming new message
  state.socket.on('message:receive', (message) => {
    if (message.roomId === state.currentRoom) {
      state.messages.push(message);
      appendMessageToChat(message);
      scrollToBottom();
      checkAndMarkMessagesRead();
    } else {
      // Check if message is a direct message
      if (message.roomId.startsWith('dm_')) {
        const sender = message.sender;
        if (!state.activeDirectMessages.has(sender.uid)) {
          state.activeDirectMessages.set(sender.uid, {
            uid: sender.uid,
            name: sender.name,
            email: sender.email,
            picture: sender.avatar,
            status: 'online',
            unreadCount: 1
          });
        } else {
          const dm = state.activeDirectMessages.get(sender.uid);
          dm.unreadCount = (dm.unreadCount || 0) + 1;
        }
        renderDirectMessagesList();
      } else {
        // Increment unread count for school channel
        state.unreadCounts[message.roomId] = (state.unreadCounts[message.roomId] || 0) + 1;
        renderChannelsList();
      }
    }
  });

  // Real-time Reaction Update
  state.socket.on('message:reaction_update', ({ roomId, messageId, reactions }) => {
    if (roomId !== state.currentRoom) return;
    const targetMsg = state.messages.find(m => m.id === messageId);
    if (targetMsg) {
      targetMsg.reactions = reactions;
    }
    const container = document.getElementById(`reactions-${messageId}`);
    if (container) {
      renderReactionPillsInto(container, { id: messageId, reactions });
    }
  });

  // Real-time Seen / Read Receipt Update
  state.socket.on('message:seen_update', ({ roomId, seenUpdates }) => {
    if (roomId !== state.currentRoom || !Array.isArray(seenUpdates)) return;
    seenUpdates.forEach(({ messageId, seenBy }) => {
      const targetMsg = state.messages.find(m => m.id === messageId);
      if (targetMsg) {
        targetMsg.seenBy = seenBy;
      }
      const indicatorEl = document.getElementById(`seen-indicator-${messageId}`);
      if (indicatorEl) {
        indicatorEl.innerHTML = buildSeenStatusHtml(seenBy, true);
      }
    });
  });

  // Direct Message Incoming Notification
  state.socket.on('dm:incoming', ({ roomId, message, sender }) => {
    if (!state.activeDirectMessages.has(sender.uid)) {
      state.activeDirectMessages.set(sender.uid, {
        uid: sender.uid,
        name: sender.name,
        email: sender.email,
        picture: sender.avatar,
        status: 'online',
        unreadCount: state.currentRoom === roomId ? 0 : 1
      });
    } else if (state.currentRoom !== roomId) {
      const dm = state.activeDirectMessages.get(sender.uid);
      dm.unreadCount = (dm.unreadCount || 0) + 1;
    }
    renderDirectMessagesList();
  });

  // Typing Indicator event from server
  state.socket.on('typing:update', (data) => {
    if (data.roomId !== state.currentRoom) return;
    if (data.userId === state.currentUser?.uid) return;

    if (data.isTyping) {
      state.activeTypers.add(data.userName);
    } else {
      state.activeTypers.delete(data.userName);
    }

    updateTypingBannerUI();
  });

  // Active Users Presence
  state.socket.on('users:presence', (onlineUsers) => {
    renderOnlineUsers(onlineUsers);
    // Also update presence status in active DMs list
    onlineUsers.forEach(u => {
      if (state.activeDirectMessages.has(u.uid)) {
        const dm = state.activeDirectMessages.get(u.uid);
        dm.status = u.status;
        dm.name = u.name || dm.name;
        dm.picture = u.picture || dm.picture;
      }
    });
    renderDirectMessagesList();
  });

  // System Room Notice (e.g. user joined)
  state.socket.on('system:notice', (notice) => {
    if (notice.roomId === state.currentRoom) {
      appendSystemNotice(notice.text);
    }
  });
}

// ==================================================================
// 7. ROOM & CHANNEL & DIRECT MESSAGING MANAGEMENT
// ==================================================================
function switchChannel(channelId) {
  state.isDirectMessage = false;
  state.dmTargetUser = null;

  const target = state.channels.find(c => c.id === channelId);
  if (!target) return;

  // Clear previous typing states
  state.activeTypers.clear();
  updateTypingBannerUI();

  // Reset unread count
  state.unreadCounts[channelId] = 0;
  state.currentRoom = channelId;

  // Restore channel header UI
  dom.channelIconSymbol.classList.remove('hidden');
  dom.dmHeaderAvatar.classList.add('hidden');
  dom.btnBackToChannels.classList.add('hidden');
  dom.currentChannelTitle.textContent = target.name;
  dom.currentChannelTopic.textContent = target.topic;
  dom.messageInput.placeholder = `Message ${target.name}... (*bold*, _italic_, \`code\`)`;

  // Clear current messages while history loads
  dom.messagesContainer.innerHTML = `
    <div class="h-full flex items-center justify-center text-slate-500 text-xs">
      <div class="flex items-center gap-2">
        <svg class="animate-spin h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Loading ${target.name} history...</span>
      </div>
    </div>
  `;

  // Inform server of room change
  if (state.socket) {
    state.socket.emit('user:join_room', { roomId: channelId });
  }

  renderChannelsList();
  renderDirectMessagesList();
}

function renderChannelsList() {
  dom.channelsList.innerHTML = '';

  state.channels.forEach(channel => {
    const isActive = !state.isDirectMessage && channel.id === state.currentRoom;
    const unread = state.unreadCounts[channel.id] || 0;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition group ${
      isActive 
        ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' 
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
    }`;

    btn.innerHTML = `
      <div class="flex items-center gap-2.5 truncate">
        <span class="${isActive ? 'text-indigo-400 font-bold' : 'text-slate-500 group-hover:text-slate-400'}">#</span>
        <span class="truncate">${channel.name.replace('#', '')}</span>
      </div>
      ${unread > 0 ? `
        <span class="ml-2 px-1.5 py-0.5 rounded-full bg-indigo-600 text-white font-bold text-[10px] shrink-0">
          ${unread}
        </span>
      ` : ''}
    `;

    btn.addEventListener('click', () => switchChannel(channel.id));
    dom.channelsList.appendChild(btn);
  });
}

// --------------------------------------------------
// Direct Messaging Handlers
// --------------------------------------------------
function openDirectMessage(targetUser) {
  if (!targetUser || !state.currentUser || targetUser.uid === state.currentUser.uid) return;

  state.isDirectMessage = true;
  state.dmTargetUser = targetUser;

  // Compute deterministic DM room ID
  const uids = [state.currentUser.uid, targetUser.uid].sort();
  const dmRoomId = `dm_${uids[0]}_${uids[1]}`;
  state.currentRoom = dmRoomId;

  // Add to active DMs map and reset unread count
  state.activeDirectMessages.set(targetUser.uid, {
    uid: targetUser.uid,
    name: targetUser.name,
    email: targetUser.email,
    picture: targetUser.picture,
    status: targetUser.status || 'online',
    unreadCount: 0
  });

  // Clear typing indicators
  state.activeTypers.clear();
  updateTypingBannerUI();

  // Configure Header UI for DM mode
  dom.channelIconSymbol.classList.add('hidden');
  dom.dmHeaderAvatar.classList.remove('hidden');
  dom.dmHeaderAvatar.src = targetUser.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(targetUser.name)}&background=6366f1&color=fff`;
  dom.btnBackToChannels.classList.remove('hidden');
  dom.currentChannelTitle.textContent = `@${targetUser.name}`;
  dom.currentChannelTopic.textContent = `Direct Message with ${targetUser.name} (${targetUser.email || 'School Student'})`;
  dom.channelOccupantsBadge.textContent = 'Private Chat';
  dom.messageInput.placeholder = `Message @${targetUser.name}... (*bold*, _italic_, \`code\`)`;

  // Loading state
  dom.messagesContainer.innerHTML = `
    <div class="h-full flex items-center justify-center text-slate-500 text-xs">
      <div class="flex items-center gap-2">
        <svg class="animate-spin h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Opening chat with ${targetUser.name}...</span>
      </div>
    </div>
  `;

  // Join DM room via socket
  if (state.socket) {
    state.socket.emit('dm:join', { targetUid: targetUser.uid });
  }

  renderChannelsList();
  renderDirectMessagesList();
}

function renderDirectMessagesList() {
  const dms = Array.from(state.activeDirectMessages.values());
  dom.dmActiveCount.textContent = dms.length;

  if (dms.length === 0) {
    dom.dmUsersList.innerHTML = `<p class="text-[11px] text-slate-500 italic px-2 py-1">Click any classmate below to start a private chat</p>`;
    return;
  }

  dom.dmUsersList.innerHTML = '';
  dms.forEach(dm => {
    const isCurrent = state.isDirectMessage && state.dmTargetUser?.uid === dm.uid;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition group ${
      isCurrent
        ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
    }`;

    const statusColors = {
      'online': 'bg-emerald-500',
      'studying': 'bg-indigo-400',
      'away': 'bg-amber-400'
    };
    const dotColor = statusColors[dm.status] || 'bg-emerald-500';

    btn.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <div class="relative shrink-0">
          <img src="${dm.picture || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(dm.name)}" class="w-5 h-5 rounded-full object-cover border border-slate-700" alt="${dm.name}" />
          <span class="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full ${dotColor} ring-1 ring-slate-900"></span>
        </div>
        <span class="truncate">${dm.name}</span>
      </div>
      ${dm.unreadCount > 0 ? `
        <span class="ml-2 px-1.5 py-0.5 rounded-full bg-indigo-600 text-white font-bold text-[10px] shrink-0 animate-bounce">
          ${dm.unreadCount}
        </span>
      ` : ''}
    `;

    btn.addEventListener('click', () => openDirectMessage(dm));
    dom.dmUsersList.appendChild(btn);
  });
}

// ==================================================================
// 8. ONLINE USERS PRESENCE
// ==================================================================
function renderOnlineUsers(users) {
  dom.onlineUsersList.innerHTML = '';
  const total = users.length;
  dom.onlineUsersCount.textContent = `${total} Online`;

  // Count active students in current room for top badge
  if (!state.isDirectMessage) {
    let currentRoomCount = 0;
    users.forEach(u => {
      if (u.currentRoom === state.currentRoom) currentRoomCount++;
    });
    dom.channelOccupantsBadge.textContent = `${currentRoomCount} active`;
  }

  users.forEach(u => {
    const isMe = state.currentUser && u.uid === state.currentUser.uid;
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-slate-800/40 transition group cursor-pointer';

    const statusColors = {
      'online': 'bg-emerald-500',
      'studying': 'bg-indigo-400',
      'away': 'bg-amber-400'
    };
    const dotColor = statusColors[u.status] || 'bg-emerald-500';

    item.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <div class="relative shrink-0">
          <img src="${u.picture || 'https://ui-avatars.com/api/?name=Student'}" class="w-7 h-7 rounded-full object-cover border border-slate-700" alt="${u.name}" />
          <span class="absolute bottom-0 right-0 w-2 h-2 rounded-full ${dotColor} ring-1 ring-slate-900"></span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-xs font-medium text-slate-300 group-hover:text-white truncate flex items-center gap-1.5">
            <span class="truncate">${u.name}</span>
            ${isMe ? '<span class="text-[10px] text-indigo-400 font-mono">(you)</span>' : ''}
          </div>
          <div class="text-[10px] text-slate-500 truncate flex items-center gap-1">
            <span>#${u.currentRoom || 'general'}</span>
            ${u.status === 'studying' ? '<span class="text-indigo-400">• Studying</span>' : ''}
          </div>
        </div>
      </div>
      ${!isMe ? `
        <button type="button" title="Send Direct Message" class="p-1 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-600/20 opacity-0 group-hover:opacity-100 transition">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      ` : ''}
    `;

    if (!isMe) {
      item.addEventListener('click', () => openDirectMessage(u));
    }

    dom.onlineUsersList.appendChild(item);
  });
}

// ==================================================================
// 9. RICH TEXT FORMATTING & PARSING
// ==================================================================
function renderFormattedText(text) {
  if (!text) return '';
  // 1. Sanitize HTML to prevent XSS
  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 2. Inline code: `code`
  safe = safe.replace(/`([^`\n]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-950/80 text-indigo-300 font-mono text-xs border border-slate-700/60">$1</code>');

  // 3. Bold: **text** or *text*
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
  safe = safe.replace(/\*([^*]+)\*/g, '<strong class="font-bold text-white">$1</strong>');

  // 4. Italic: _text_
  safe = safe.replace(/_([^_]+)_/g, '<em class="italic text-slate-100">$1</em>');

  // 5. Strikethrough: ~~text~~ or ~text~
  safe = safe.replace(/~~([^~]+)~~/g, '<del class="line-through text-slate-400">$1</del>');
  safe = safe.replace(/~([^~]+)~/g, '<del class="line-through text-slate-400">$1</del>');

  // 6. URLs: autolink
  safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline text-indigo-400 hover:text-indigo-200 break-all">$1</a>');

  return safe;
}

function insertFormatWrapper(prefix, suffix = prefix) {
  const input = dom.messageInput;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const val = input.value;
  const selected = val.substring(start, end);
  const insertText = selected || 'text';
  const replacement = `${prefix}${insertText}${suffix}`;
  input.value = val.substring(0, start) + replacement + val.substring(end);
  input.focus();
  const newStart = start + prefix.length;
  const newEnd = newStart + insertText.length;
  input.setSelectionRange(newStart, newEnd);
  handleTypingInput();
}

// ==================================================================
// 10. EMOJI PICKER POPOVER
// ==================================================================
function initEmojiPicker() {
  renderEmojiPicker('smileys');

  // Category Tab Toggles
  dom.emojiCatTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      dom.emojiCatTabs.forEach(t => {
        t.className = 'emoji-cat-tab text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white';
      });
      tab.className = 'emoji-cat-tab active text-xs px-2 py-0.5 rounded bg-indigo-600 text-white';
      const cat = tab.getAttribute('data-category');
      renderEmojiPicker(cat);
    });
  });

  // Toggle button
  dom.btnToggleEmojiPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.emojiPickerPopover.classList.toggle('hidden');
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!dom.emojiPickerPopover.classList.contains('hidden')) {
      if (!dom.emojiPickerPopover.contains(e.target) && e.target !== dom.btnToggleEmojiPicker && !dom.btnToggleEmojiPicker.contains(e.target)) {
        dom.emojiPickerPopover.classList.add('hidden');
      }
    }
  });
}

function renderEmojiPicker(category) {
  dom.emojiPickerGrid.innerHTML = '';
  const emojis = state.emojiCategories[category] || state.emojiCategories.smileys;
  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800 active:scale-95 transition text-lg cursor-pointer';
    btn.textContent = emoji;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      insertEmoji(emoji);
    });
    dom.emojiPickerGrid.appendChild(btn);
  });
}

function insertEmoji(emoji) {
  const input = dom.messageInput;
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const val = input.value;
  input.value = val.substring(0, start) + emoji + val.substring(end);
  const newPos = start + emoji.length;
  input.focus();
  input.setSelectionRange(newPos, newPos);
  handleTypingInput();
}

// ==================================================================
// 11. MESSAGING, REACTIONS & READ RECEIPTS
// ==================================================================
function renderMessagesList(messages) {
  dom.messagesContainer.innerHTML = '';
  if (!messages || messages.length === 0) {
    const title = state.isDirectMessage ? `@${state.dmTargetUser?.name || 'Classmate'}` : `#${state.currentRoom}`;
    const subtitle = state.isDirectMessage 
      ? `This is the beginning of your direct message history with ${state.dmTargetUser?.name}. Messages are saved to Firestore.`
      : `This is the start of the #${state.currentRoom} channel. Say hello to your classmates!`;

    dom.messagesContainer.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
        <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-indigo-400 mb-2">
          ${state.isDirectMessage ? '💬' : '#'}
        </div>
        <h3 class="text-sm font-semibold text-slate-300">Welcome to ${title}</h3>
        <p class="text-xs text-slate-500 mt-1 max-w-sm">${subtitle}</p>
      </div>
    `;
    return;
  }

  messages.forEach(msg => appendMessageToChat(msg));
  scrollToBottom();
}

function appendMessageToChat(message) {
  const isMe = state.currentUser && message.sender && message.sender.uid === state.currentUser.uid;
  
  const msgWrapper = document.createElement('div');
  msgWrapper.id = `msg-row-${message.id}`;
  msgWrapper.className = `relative flex gap-3 max-w-3xl ${isMe ? 'ml-auto flex-row-reverse' : 'mr-auto'} group my-2`;

  // Floating Message Action Bar (Reactions)
  const actionBar = buildMessageActionBar(message);
  msgWrapper.appendChild(actionBar);

  // Avatar
  const avatar = document.createElement('img');
  avatar.src = message.sender?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(message.sender?.name || 'Student')}&background=3b82f6&color=fff`;
  avatar.alt = message.sender?.name || 'Student';
  avatar.className = 'w-8 h-8 rounded-full object-cover shrink-0 mt-0.5 border border-slate-800';

  // Bubble wrapper
  const contentWrapper = document.createElement('div');
  contentWrapper.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%]`;

  // Header (name + timestamp + seen receipt)
  const metaHeader = document.createElement('div');
  metaHeader.className = `flex items-center gap-2 mb-1 px-1 text-xs text-slate-400 ${isMe ? 'flex-row-reverse' : ''}`;
  
  metaHeader.innerHTML = `
    <span class="font-semibold text-slate-200">${isMe ? 'You' : (message.sender?.name || 'Student')}</span>
    ${!isMe ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">Student</span>' : ''}
    <span class="text-[11px] text-slate-500">${message.formattedTime || ''}</span>
    ${isMe ? `<span id="seen-indicator-${message.id}">${buildSeenStatusHtml(message.seenBy, true)}</span>` : ''}
  `;

  // Bubble content with rich text formatting (if text content present)
  if (message.content && message.content.trim()) {
    const bubble = document.createElement('div');
    bubble.className = `px-4 py-2.5 text-sm rounded-2xl break-words leading-relaxed shadow-sm ${
      isMe 
        ? 'bg-indigo-600 text-white rounded-tr-none shadow-indigo-600/10' 
        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
    }`;
    bubble.innerHTML = renderFormattedText(message.content);
    contentWrapper.appendChild(bubble);
  }

  // Image Attachment Preview (if photo present)
  if (message.image) {
    const imgContainer = document.createElement('div');
    imgContainer.className = `rounded-2xl overflow-hidden cursor-pointer border border-slate-700/60 bg-black/40 relative group/img max-w-xs sm:max-w-sm transition hover:border-indigo-500/60 shadow-md ${
      message.content && message.content.trim() ? 'mt-1.5' : ''
    }`;
    
    const img = document.createElement('img');
    img.src = message.image;
    img.alt = 'Shared photo';
    img.className = 'w-full max-h-72 object-cover transition duration-200 group-hover/img:scale-[1.01]';
    img.loading = 'lazy';

    const zoomOverlay = document.createElement('div');
    zoomOverlay.className = 'absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-black/75 text-white text-[11px] font-medium opacity-0 group-hover/img:opacity-100 transition flex items-center gap-1 backdrop-blur-sm pointer-events-none';
    zoomOverlay.innerHTML = `
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
      </svg>
      <span>Expand</span>
    `;

    imgContainer.appendChild(img);
    imgContainer.appendChild(zoomOverlay);

    imgContainer.addEventListener('click', () => {
      openImageLightbox(message.image, message.content || `Photo shared by ${message.sender?.name || 'Student'}`);
    });

    contentWrapper.appendChild(imgContainer);
  }

  // Reaction Pills Container below bubble
  const reactionsContainer = buildReactionPillsContainer(message);

  contentWrapper.appendChild(metaHeader);
  contentWrapper.appendChild(reactionsContainer);

  msgWrapper.appendChild(avatar);
  msgWrapper.appendChild(contentWrapper);

  dom.messagesContainer.appendChild(msgWrapper);
}

// --------------------------------------------------
// Reaction UI & Handlers
// --------------------------------------------------
function buildMessageActionBar(message) {
  const bar = document.createElement('div');
  bar.className = 'hidden group-hover:flex items-center gap-0.5 px-2 py-1 rounded-xl bg-slate-900/95 border border-slate-700/80 shadow-xl text-sm absolute -top-3.5 right-2 z-10 backdrop-blur-sm transition-all';

  const quickEmojis = ['👍', '❤️', '😂', '🔥', '📚', '🚀'];
  quickEmojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800 active:scale-95 transition text-xs cursor-pointer';
    btn.textContent = emoji;
    btn.title = `React ${emoji}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMessageReaction(message.id, emoji);
    });
    bar.appendChild(btn);
  });

  return bar;
}

function buildReactionPillsContainer(message) {
  const container = document.createElement('div');
  container.id = `reactions-${message.id}`;
  container.className = 'flex flex-wrap items-center gap-1 mt-1.5';
  renderReactionPillsInto(container, message);
  return container;
}

function renderReactionPillsInto(container, message) {
  container.innerHTML = '';
  const reactions = message.reactions || {};
  const currentUid = state.currentUser?.uid;

  Object.entries(reactions).forEach(([emoji, userUids]) => {
    if (!Array.isArray(userUids) || userUids.length === 0) return;
    const hasMyReaction = currentUid && userUids.includes(currentUid);

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition border cursor-pointer ${
      hasMyReaction
        ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200 font-semibold shadow-sm'
        : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:bg-slate-800'
    }`;
    pill.title = `${userUids.length} reaction${userUids.length > 1 ? 's' : ''} (${userUids.length} classmate${userUids.length > 1 ? 's' : ''})`;
    pill.innerHTML = `<span>${emoji}</span> <span class="text-[11px] font-mono">${userUids.length}</span>`;

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMessageReaction(message.id, emoji);
    });

    container.appendChild(pill);
  });
}

function toggleMessageReaction(messageId, emoji) {
  if (!state.socket || !messageId || !emoji) return;
  state.socket.emit('message:react', {
    roomId: state.currentRoom,
    messageId,
    emoji
  });
}

// --------------------------------------------------
// Read Receipts Handlers
// --------------------------------------------------
function checkAndMarkMessagesRead() {
  if (!state.currentUser || !state.socket) return;
  const unreadMessageIds = [];

  state.messages.forEach(msg => {
    if (msg.sender && msg.sender.uid !== state.currentUser.uid) {
      const seen = Array.isArray(msg.seenBy) && msg.seenBy.some(s => s.uid === state.currentUser.uid);
      if (!seen) {
        unreadMessageIds.push(msg.id);
      }
    }
  });

  if (unreadMessageIds.length > 0) {
    state.socket.emit('message:read', {
      roomId: state.currentRoom,
      messageIds: unreadMessageIds
    });
  }
}

function buildSeenStatusHtml(seenBy, isMe) {
  if (!isMe) return '';
  const seenList = Array.isArray(seenBy) ? seenBy : [];
  if (seenList.length > 0) {
    const names = seenList.map(s => s.name || 'Classmate').join(', ');
    return `
      <span class="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium select-none" title="Seen by: ${names}">
        <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
        </svg>
        <span>Seen</span>
      </span>
    `;
  } else {
    return `
      <span class="inline-flex items-center gap-0.5 text-[10px] text-slate-500 font-normal select-none" title="Delivered">
        <svg class="w-3 h-3 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
        </svg>
        <span>Sent</span>
      </span>
    `;
  }
}

function appendSystemNotice(text) {
  const notice = document.createElement('div');
  notice.className = 'flex items-center justify-center my-2 text-[11px] text-slate-500';
  notice.innerHTML = `
    <div class="px-3 py-1 rounded-full bg-slate-900/60 border border-slate-800/80">
      ${text}
    </div>
  `;
  dom.messagesContainer.appendChild(notice);
  scrollToBottom();
}

function scrollToBottom() {
  dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
}

function updateTypingBannerUI() {
  if (state.activeTypers.size === 0) {
    dom.typingContent.classList.add('hidden');
    return;
  }

  const names = Array.from(state.activeTypers);
  let text = '';
  if (names.length === 1) {
    text = `${names[0]} is typing`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing`;
  } else {
    text = `${names[0]} and ${names.length - 1} others are typing`;
  }

  dom.typingText.textContent = text;
  dom.typingContent.classList.remove('hidden');
}

// Handle sending message
function sendMessage() {
  const content = dom.messageInput.value.trim();
  const image = state.stagedImage;

  if ((!content && !image) || !state.socket) return;

  state.socket.emit('message:send', {
    roomId: state.currentRoom,
    content: content,
    image: image || null
  });

  // Clear staged photo
  if (image) {
    clearStagedPhoto();
  }

  // Stop typing indicator immediately
  stopTyping();
  dom.messageInput.value = '';
}

// Typing debounce handlers
function handleTypingInput() {
  if (!state.socket) return;

  if (!state.isTyping) {
    state.isTyping = true;
    state.socket.emit('typing:start', { roomId: state.currentRoom });
  }

  // Clear previous timer and set new 2-second timeout
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    stopTyping();
  }, 2000);
}

function stopTyping() {
  if (state.isTyping && state.socket) {
    state.isTyping = false;
    state.socket.emit('typing:stop', { roomId: state.currentRoom });
  }
  clearTimeout(state.typingTimeout);
}

// ==================================================================
// 12. CAMERA CAPTURE, PHOTO PREVIEW & LIGHTBOX
// ==================================================================

function openCameraModal() {
  dom.modalCamera.classList.remove('hidden');
  resetCameraModalState();
  startCameraStream();
}

function resetCameraModalState() {
  state.capturedSnapshot = null;
  dom.cameraCaptionInput.value = '';
  dom.cameraLiveControls.classList.remove('hidden');
  dom.cameraPreviewControls.classList.add('hidden');
  dom.cameraPreviewImg.classList.add('hidden');
  dom.cameraPreviewImg.src = '';
  dom.cameraVideo.classList.remove('hidden');
  dom.cameraLoadingState.classList.remove('hidden');
  dom.cameraErrorState.classList.add('hidden');
  dom.cameraModalTitle.textContent = 'Take Photo with Camera';
}

async function startCameraStream() {
  stopCameraStream();
  dom.cameraLoadingState.classList.remove('hidden');
  dom.cameraErrorState.classList.add('hidden');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraError('Camera API is not supported in this browser. You can still upload images from your device.');
    return;
  }

  try {
    const constraints = {
      video: {
        facingMode: state.cameraFacingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.cameraStream = stream;
    dom.cameraVideo.srcObject = stream;
    dom.cameraVideo.onloadedmetadata = () => {
      dom.cameraVideo.play().catch(e => console.warn('Autoplay error:', e));
      dom.cameraLoadingState.classList.add('hidden');
    };
  } catch (err) {
    console.warn('Camera access error:', err);
    const msg = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
      ? 'Camera access was blocked. Please grant camera permissions in your browser.'
      : (err.message || 'Unable to start camera viewfinder.');
    showCameraError(msg);
  }
}

function showCameraError(message) {
  dom.cameraLoadingState.classList.add('hidden');
  dom.cameraErrorState.classList.remove('hidden');
  dom.cameraErrorMessage.textContent = message;
}

function stopCameraStream() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => {
      track.stop();
    });
    state.cameraStream = null;
  }
  dom.cameraVideo.srcObject = null;
}

function closeCameraModal() {
  stopCameraStream();
  dom.modalCamera.classList.add('hidden');
  state.capturedSnapshot = null;
}

function flipCamera() {
  state.cameraFacingMode = state.cameraFacingMode === 'user' ? 'environment' : 'user';
  startCameraStream();
}

function snapPhoto() {
  const video = dom.cameraVideo;
  if (!video || !state.cameraStream) return;

  // Flash animation
  dom.cameraFlash.style.opacity = '0.9';
  setTimeout(() => {
    dom.cameraFlash.style.opacity = '0';
  }, 120);

  const canvas = dom.cameraCanvas;
  let width = video.videoWidth || 640;
  let height = video.videoHeight || 480;

  // Scale down to max 1024px to keep WebSocket transmission snappy & lightweight
  const maxDim = 1024;
  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // If user facing mode, mirror horizontally for natural feel
  if (state.cameraFacingMode === 'user') {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(video, 0, 0, width, height);

  // Convert to high-quality JPEG base64
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  state.capturedSnapshot = dataUrl;

  // Switch modal to preview mode
  dom.cameraPreviewImg.src = dataUrl;
  dom.cameraPreviewImg.classList.remove('hidden');
  dom.cameraVideo.classList.add('hidden');
  dom.cameraLiveControls.classList.add('hidden');
  dom.cameraPreviewControls.classList.remove('hidden');
  dom.cameraModalTitle.textContent = 'Preview & Share Photo';
  dom.cameraCaptionInput.focus();
}

function retakePhoto() {
  state.capturedSnapshot = null;
  dom.cameraPreviewImg.classList.add('hidden');
  dom.cameraPreviewImg.src = '';
  dom.cameraVideo.classList.remove('hidden');
  dom.cameraPreviewControls.classList.add('hidden');
  dom.cameraLiveControls.classList.remove('hidden');
  dom.cameraModalTitle.textContent = 'Take Photo with Camera';
}

function stagePhoto(dataUrl) {
  state.stagedImage = dataUrl;
  dom.stagedPhotoImg.src = dataUrl;
  dom.stagedPhotoPreview.classList.remove('hidden');
}

function clearStagedPhoto() {
  state.stagedImage = null;
  dom.stagedPhotoImg.src = '';
  dom.stagedPhotoPreview.classList.add('hidden');
}

function attachCapturedPhotoToDraft() {
  if (!state.capturedSnapshot) return;
  stagePhoto(state.capturedSnapshot);

  const caption = dom.cameraCaptionInput.value.trim();
  if (caption && !dom.messageInput.value.trim()) {
    dom.messageInput.value = caption;
  }

  closeCameraModal();
  dom.messageInput.focus();
}

function sendCapturedPhotoDirectly() {
  if (!state.capturedSnapshot || !state.socket) return;
  const caption = dom.cameraCaptionInput.value.trim();

  state.socket.emit('message:send', {
    roomId: state.currentRoom,
    content: caption,
    image: state.capturedSnapshot
  });

  closeCameraModal();
  clearStagedPhoto();
}

function handleImageFileInput(file) {
  if (!file || !file.type.startsWith('image/')) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const tempImg = new Image();
    tempImg.onload = () => {
      const canvas = dom.cameraCanvas;
      let width = tempImg.width;
      let height = tempImg.height;
      const maxDim = 1024;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(tempImg, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      state.capturedSnapshot = dataUrl;
      dom.cameraPreviewImg.src = dataUrl;
      dom.cameraPreviewImg.classList.remove('hidden');
      dom.cameraVideo.classList.add('hidden');
      dom.cameraLoadingState.classList.add('hidden');
      dom.cameraErrorState.classList.add('hidden');
      dom.cameraLiveControls.classList.add('hidden');
      dom.cameraPreviewControls.classList.remove('hidden');
      dom.cameraModalTitle.textContent = 'Preview & Share Image';
      dom.cameraCaptionInput.focus();
    };
    tempImg.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Lightbox modal functions
function openImageLightbox(src, caption) {
  dom.lightboxImage.src = src;
  dom.lightboxCaption.textContent = caption || '';
  dom.lightboxDownloadLink.href = src;
  dom.modalImageLightbox.classList.remove('hidden');
}

function closeImageLightbox() {
  dom.modalImageLightbox.classList.add('hidden');
  dom.lightboxImage.src = '';
}

// ==================================================================
// 12.5. COLOR THEME MANAGEMENT ('Midnight', 'Ocean', 'Forest')
// ==================================================================
const THEMES = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    icon: '🌙',
    className: 'theme-midnight',
    description: 'Deep obsidian dark slate'
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    icon: '🌊',
    className: 'theme-ocean',
    description: 'Abyssal navy with cyan accents'
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    icon: '🌲',
    className: 'theme-forest',
    description: 'Deep woodland with emerald accents'
  }
};

function applyTheme(themeId, saveToStorage = true) {
  const validThemeId = THEMES[themeId] ? themeId : 'midnight';
  state.currentTheme = validThemeId;

  // Update classes on root html element
  document.documentElement.classList.remove('theme-midnight', 'theme-ocean', 'theme-forest');
  document.documentElement.classList.add(THEMES[validThemeId].className);

  // Synchronize the dropdown select in settings modal
  if (dom.themeSelector) {
    dom.themeSelector.value = validThemeId;
  }

  // Synchronize header quick button display
  if (dom.currentThemeIcon) {
    dom.currentThemeIcon.textContent = THEMES[validThemeId].icon;
  }
  if (dom.currentThemeName) {
    dom.currentThemeName.textContent = THEMES[validThemeId].name;
  }

  // Update visual swatch card selection borders and badges
  if (dom.themeOptionBtns && dom.themeOptionBtns.length) {
    dom.themeOptionBtns.forEach(btn => {
      const btnTheme = btn.getAttribute('data-theme-val');
      if (btnTheme === validThemeId) {
        btn.classList.add('ring-2', 'ring-indigo-500', 'border-indigo-500/80', 'bg-slate-800/80');
        btn.classList.remove('border-slate-800');
      } else {
        btn.classList.remove('ring-2', 'ring-indigo-500', 'border-indigo-500/80', 'bg-slate-800/80');
        btn.classList.add('border-slate-800');
      }
    });
  }

  // Persist preference to localStorage
  if (saveToStorage) {
    try {
      localStorage.setItem('campusconnect_theme', validThemeId);
    } catch (e) {
      console.warn('Could not save theme preference to localStorage:', e);
    }
  }

  console.log(`🎨 Chat interface theme set to: ${validThemeId}`);
}

function initTheme() {
  const savedTheme = localStorage.getItem('campusconnect_theme') || 'midnight';
  applyTheme(savedTheme, false);
}

// ==================================================================
// 13. EVENT LISTENERS
// ==================================================================
function setupEventListeners() {
  // Auth Tab Toggles
  dom.tabSignIn.addEventListener('click', () => setAuthMode('signin'));
  dom.tabRegister.addEventListener('click', () => setAuthMode('register'));

  // Auth Form
  dom.authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleEmailPasswordAuth();
  });

  // Google Sign-In Button
  dom.btnGoogleAuth.addEventListener('click', handleGoogleSignIn);

  // Demo Login Buttons
  dom.demoLoginButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-name');
      const email = btn.getAttribute('data-email');
      handleDemoLogin(name, email);
    });
  });

  // Back to Channels Button from DM mode
  dom.btnBackToChannels.addEventListener('click', () => {
    switchChannel('general');
  });

  // Message Form & Inputs
  dom.messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  dom.messageInput.addEventListener('input', handleTypingInput);
  dom.messageInput.addEventListener('blur', stopTyping);

  // Rich Text Formatting Buttons
  dom.btnFormatBold.addEventListener('click', () => insertFormatWrapper('*'));
  dom.btnFormatItalic.addEventListener('click', () => insertFormatWrapper('_'));
  dom.btnFormatStrike.addEventListener('click', () => insertFormatWrapper('~'));
  dom.btnFormatCode.addEventListener('click', () => insertFormatWrapper('`'));

  // Quick Emoji Clickers
  dom.quickEmojis.forEach(btn => {
    btn.addEventListener('click', () => {
      insertEmoji(btn.textContent.trim());
    });
  });

  // Initialize Emoji Picker Popover
  initEmojiPicker();

  // Status Selector
  dom.statusSelector.addEventListener('change', (e) => {
    const status = e.target.value;
    const colors = {
      'online': 'bg-emerald-500',
      'studying': 'bg-indigo-400',
      'away': 'bg-amber-400'
    };
    dom.myStatusIndicator.className = `absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ${colors[status]} ring-2 ring-slate-900`;

    if (state.socket) {
      state.socket.emit('status:change', { status });
    }
  });

  // Visibility change to trigger read receipts when returning to chat tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAndMarkMessagesRead();
    }
  });

  // Logout
  dom.btnLogout.addEventListener('click', async () => {
    if (state.isFirebaseActive) {
      try {
        await firebase.auth().signOut();
      } catch (err) {
        console.warn('Signout error:', err);
      }
    }
    handleUserLoggedOut();
  });

  // Setup / Config Guide Modal
  const openModal = () => dom.modalConfig.classList.remove('hidden');
  const closeModal = () => dom.modalConfig.classList.add('hidden');

  dom.btnOpenConfigGuide.addEventListener('click', openModal);
  dom.btnOpenSettings.addEventListener('click', openModal);
  if (dom.btnQuickThemeToggle) {
    dom.btnQuickThemeToggle.addEventListener('click', openModal);
  }
  dom.btnCloseModal.addEventListener('click', closeModal);
  dom.btnModalDismiss.addEventListener('click', closeModal);

  // Theme Dropdown & Swatch Controls
  if (dom.themeSelector) {
    dom.themeSelector.addEventListener('change', (e) => {
      applyTheme(e.target.value, true);
    });
  }

  if (dom.themeOptionBtns && dom.themeOptionBtns.length) {
    dom.themeOptionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const themeId = btn.getAttribute('data-theme-val');
        if (themeId) {
          applyTheme(themeId, true);
        }
      });
    });
  }

  // Camera & Image Capture Event Listeners
  dom.btnOpenCamera.addEventListener('click', openCameraModal);
  dom.btnCloseCamera.addEventListener('click', closeCameraModal);
  dom.btnSnapPhoto.addEventListener('click', snapPhoto);
  dom.btnRetakePhoto.addEventListener('click', retakePhoto);
  dom.btnAttachPhoto.addEventListener('click', attachCapturedPhotoToDraft);
  dom.btnSendPhotoNow.addEventListener('click', sendCapturedPhotoDirectly);
  dom.btnFlipCamera.addEventListener('click', flipCamera);
  dom.btnRetryCamera.addEventListener('click', startCameraStream);

  // Staged Preview Controls
  dom.btnDiscardStagedPhoto.addEventListener('click', clearStagedPhoto);
  dom.btnPreviewStagedPhoto.addEventListener('click', () => {
    if (state.stagedImage) {
      openImageLightbox(state.stagedImage, 'Staged photo draft');
    }
  });
  dom.btnStagedImgThumbnail.addEventListener('click', () => {
    if (state.stagedImage) {
      openImageLightbox(state.stagedImage, 'Staged photo draft');
    }
  });

  // Alternative & Fallback File Upload Inputs
  dom.cameraFallbackFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImageFileInput(e.target.files[0]);
    }
  });
  dom.cameraAltUpload.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImageFileInput(e.target.files[0]);
    }
  });

  // Lightbox Close Handlers
  dom.btnCloseLightbox.addEventListener('click', closeImageLightbox);
  dom.modalImageLightbox.addEventListener('click', (e) => {
    if (e.target === dom.modalImageLightbox) {
      closeImageLightbox();
    }
  });

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.modalCamera.classList.contains('hidden')) {
        closeCameraModal();
      }
      if (!dom.modalImageLightbox.classList.contains('hidden')) {
        closeImageLightbox();
      }
      if (!dom.modalConfig.classList.contains('hidden')) {
        closeModal();
      }
    }
  });
}

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  initializeFirebase();
});
