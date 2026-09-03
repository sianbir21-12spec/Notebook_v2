/**
 * CampusConnect - Real-time School Friend Group Chat Server
 * Tech Stack: Node.js, Express, Socket.IO, Firebase Admin SDK
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Enable CORS for development and cross-origin requests
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Serve static frontend files from 'public' directory
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

// ==========================================
// 1. FIREBASE ADMIN & FIRESTORE INITIALIZATION
// ==========================================
let isFirebaseAdminReady = false;
let firestoreDb = null;
let firebaseAppletConfig = null;

const appletConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');

try {
  if (fs.existsSync(appletConfigPath)) {
    firebaseAppletConfig = JSON.parse(fs.readFileSync(appletConfigPath, 'utf8'));
  }
} catch (e) {
  console.warn('⚠️ Could not load firebase-applet-config.json:', e.message);
}

try {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    if (serviceAccount.project_id && !serviceAccount.project_id.includes('YOUR_')) {
      const adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      isFirebaseAdminReady = true;
      try {
        const dbId = firebaseAppletConfig?.firestoreDatabaseId;
        firestoreDb = dbId ? getFirestore(adminApp, dbId) : getFirestore(adminApp);
        console.log(`✅ [Firebase Admin] Initialized with serviceAccountKey.json credentials and Firestore ready (dbId: ${dbId || 'default'}).`);
      } catch (fsErr) {
        console.warn('⚠️ [Firebase Admin] Could not initialize Firestore:', fsErr.message);
      }
    }
  }

  if (!isFirebaseAdminReady && firebaseAppletConfig && firebaseAppletConfig.projectId) {
    const adminApp = admin.initializeApp({
      projectId: firebaseAppletConfig.projectId
    });
    isFirebaseAdminReady = true;
    try {
      const dbId = firebaseAppletConfig.firestoreDatabaseId;
      firestoreDb = dbId ? getFirestore(adminApp, dbId) : getFirestore(adminApp);
      console.log(`✅ [Firebase Admin] Initialized with firebase-applet-config.json (Project: ${firebaseAppletConfig.projectId}, dbId: ${dbId || 'default'}).`);
    } catch (fsErr) {
      console.warn('⚠️ [Firebase Admin] Firestore initialization error:', fsErr.message);
    }
  } else if (!isFirebaseAdminReady && (process.env.FIREBASE_CONFIG || process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    const adminApp = admin.initializeApp();
    isFirebaseAdminReady = true;
    try {
      firestoreDb = getFirestore(adminApp);
      console.log('✅ [Firebase Admin] Initialized with environment credentials and Firestore ready.');
    } catch (fsErr) {
      console.warn('⚠️ [Firebase Admin] Could not initialize Firestore:', fsErr.message);
    }
  }

  if (!isFirebaseAdminReady) {
    console.warn('⚠️ [Firebase Admin] No Firebase credentials found. Running in Dev/Demo token mode.');
  }
} catch (err) {
  console.error('❌ [Firebase Admin] Error initializing Admin SDK:', err.message);
  console.warn('⚠️ Falling back to Dev/Demo token mode so the app remains fully usable.');
}

// Helper to verify Firebase ID Token or decode Dev Token
async function verifyAuthToken(token, clientUser = null) {
  if (!token) throw new Error('Authentication token is required');

  // If real Firebase Admin is initialized and token is not a demo token
  if (isFirebaseAdminReady && !token.startsWith('demo-token-')) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      return {
        uid: decodedToken.uid,
        email: decodedToken.email || '',
        name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Student',
        picture: decodedToken.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(decodedToken.name || 'Student')}&background=3b82f6&color=fff`,
        authType: 'firebase-admin'
      };
    } catch (err) {
      console.warn('Token verification error against Firebase Admin:', err.message);
      // If verification fails but client sent user details in dev mode
      if (process.env.NODE_ENV !== 'production' && clientUser && clientUser.uid) {
        return {
          uid: clientUser.uid,
          email: clientUser.email || '',
          name: clientUser.name || 'Student',
          picture: clientUser.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(clientUser.name || 'Student')}&background=3b82f6&color=fff`,
          authType: 'dev-fallback'
        };
      }
      throw new Error(`Firebase token verification failed: ${err.message}`);
    }
  }

  // Dev / Demo Token handling (allows instant testing in sandbox/preview)
  if (token.startsWith('demo-token-') || !isFirebaseAdminReady) {
    const fallbackName = clientUser?.name || 'Student';
    return {
      uid: clientUser?.uid || `demo_${Math.random().toString(36).substring(2, 9)}`,
      email: clientUser?.email || 'student@school.edu',
      name: fallbackName,
      picture: clientUser?.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=3b82f6&color=fff`,
      authType: 'demo-sandbox'
    };
  }

  throw new Error('Unauthorized');
}

// ==========================================
// 2. IN-MEMORY STATE & CHANNELS MANAGEMENT
// ==========================================

// Predefined School Channels
const CHANNELS = [
  {
    id: 'general',
    name: '#general',
    topic: 'Campus life, casual chats & announcements',
    icon: 'message-square'
  },
  {
    id: 'homework-help',
    name: '#homework-help',
    topic: 'Math, Science, History & study group Q&A',
    icon: 'book-open'
  },
  {
    id: 'gaming',
    name: '#gaming',
    topic: 'Esports, Valorant, Minecraft & Discord hangouts',
    icon: 'gamepad-2'
  },
  {
    id: 'hangouts',
    name: '#hangouts',
    topic: 'Weekend plans, lunch meetups & campus chill',
    icon: 'coffee'
  },
  {
    id: 'events',
    name: '#events',
    topic: 'School rallies, hackathons, sports & club meetings',
    icon: 'calendar'
  }
];

// In-Memory message histories per room (stores last 100 messages)
const roomHistories = new Map();

// Helper to format timestamp into 12-hour AM/PM
function formatTimestamp(timestamp = Date.now()) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Seed initial messages for school channels so it feels alive
function seedChannelHistories() {
  const now = Date.now();
  
  roomHistories.set('general', [
    {
      id: 'msg_seed_1',
      roomId: 'general',
      sender: {
        uid: 'sys_alex',
        name: 'Alex Rivera',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
        email: 'alex@school.edu'
      },
      content: 'Hey everyone! Welcome to our school group chat hub! 🎒📚 *Check out* the new channels.',
      timestamp: now - 3600000,
      formattedTime: formatTimestamp(now - 3600000),
      reactions: { '👍': ['sys_maya'] },
      seenBy: [{ uid: 'sys_maya', name: 'Maya Chen', seenAt: now - 3500000 }]
    },
    {
      id: 'msg_seed_2',
      roomId: 'general',
      sender: {
        uid: 'sys_maya',
        name: 'Maya Chen',
        avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80',
        email: 'maya@school.edu'
      },
      content: 'Loving the clean layout! Try sending `code blocks` or _italics_! 🚀',
      timestamp: now - 1800000,
      formattedTime: formatTimestamp(now - 1800000),
      reactions: { '🔥': ['sys_alex'], '❤️': ['sys_jordan'] },
      seenBy: [{ uid: 'sys_alex', name: 'Alex Rivera', seenAt: now - 1700000 }]
    }
  ]);

  roomHistories.set('homework-help', [
    {
      id: 'msg_seed_3',
      roomId: 'homework-help',
      sender: {
        uid: 'sys_jordan',
        name: 'Jordan Smith',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80',
        email: 'jordan@school.edu'
      },
      content: 'Anyone working on Calculus Problem Set #4? Specifically question 3 on derivatives?',
      timestamp: now - 1200000,
      formattedTime: formatTimestamp(now - 1200000),
      reactions: { '🤔': ['sys_maya'] },
      seenBy: [{ uid: 'sys_maya', name: 'Maya Chen', seenAt: now - 1100000 }]
    },
    {
      id: 'msg_seed_4',
      roomId: 'homework-help',
      sender: {
        uid: 'sys_maya',
        name: 'Maya Chen',
        avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80',
        email: 'maya@school.edu'
      },
      content: 'Yes! You have to apply the quotient rule first, then factor out the polynomial.',
      timestamp: now - 600000,
      formattedTime: formatTimestamp(now - 600000),
      reactions: { '💡': ['sys_jordan'], '🙌': ['sys_jordan'] },
      seenBy: [{ uid: 'sys_jordan', name: 'Jordan Smith', seenAt: now - 500000 }]
    }
  ]);

  roomHistories.set('gaming', [
    {
      id: 'msg_seed_5',
      roomId: 'gaming',
      sender: {
        uid: 'sys_alex',
        name: 'Alex Rivera',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
        email: 'alex@school.edu'
      },
      content: 'Who is down for some custom lobbies tonight around 8 PM? 🎮🔥',
      timestamp: now - 900000,
      formattedTime: formatTimestamp(now - 900000),
      reactions: { '🎮': ['sys_jordan'] },
      seenBy: []
    }
  ]);

  roomHistories.set('hangouts', []);
  roomHistories.set('events', []);
}

seedChannelHistories();

// Helper to compute deterministic Direct Message Room ID for two users
function getDmRoomId(uid1, uid2) {
  return 'dm_' + [uid1, uid2].sort().join('_');
}

// ==========================================
// FIRESTORE & IN-MEMORY MESSAGE HELPERS
// ==========================================

// Save a new message to Firestore and in-memory cache
async function saveMessage(messageObj) {
  const { roomId } = messageObj;

  // 1. Maintain in-memory cache
  if (!roomHistories.has(roomId)) {
    roomHistories.set(roomId, []);
  }
  const history = roomHistories.get(roomId);
  history.push(messageObj);
  if (history.length > 100) {
    history.shift();
  }

  // 2. Persist in Firestore if available
  if (firestoreDb) {
    try {
      await firestoreDb.collection('messages').doc(messageObj.id).set({
        id: messageObj.id,
        roomId: messageObj.roomId,
        content: messageObj.content || '',
        image: messageObj.image || null,
        sender: messageObj.sender,
        timestamp: messageObj.timestamp,
        formattedTime: messageObj.formattedTime,
        reactions: messageObj.reactions || {},
        seenBy: messageObj.seenBy || [],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`💾 [Firestore] Saved message ${messageObj.id} to Firestore collection 'messages' for room ${roomId}`);
    } catch (fsErr) {
      console.warn(`⚠️ [Firestore] Failed to persist message ${messageObj.id} to Firestore:`, fsErr.message);
    }
  }
}

// Fetch the last 50 messages for a room or DM from Firestore (or fallback to memory)
async function getRoomMessages(roomId, limit = 50) {
  if (firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('messages')
        .where('roomId', '==', roomId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      if (!snapshot.empty) {
        const msgs = [];
        snapshot.forEach(doc => {
          msgs.push(doc.data());
        });
        msgs.reverse(); // Return in ascending chronological order

        // Sync to in-memory cache
        roomHistories.set(roomId, msgs);
        return msgs;
      }
    } catch (fsErr) {
      console.warn(`⚠️ [Firestore] Message history fetch for ${roomId} failed, falling back to local memory:`, fsErr.message);
    }
  }

  // In-memory fallback
  const history = roomHistories.get(roomId) || [];
  return history.slice(-limit);
}

// Toggle emoji reaction for a message
async function updateMessageReactions(roomId, messageId, emoji, uid) {
  const history = roomHistories.get(roomId) || [];
  const msg = history.find(m => m.id === messageId);
  if (!msg) return null;

  if (!msg.reactions) msg.reactions = {};
  if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

  const existingIdx = msg.reactions[emoji].indexOf(uid);
  if (existingIdx > -1) {
    // User already reacted: toggle off
    msg.reactions[emoji].splice(existingIdx, 1);
    if (msg.reactions[emoji].length === 0) {
      delete msg.reactions[emoji];
    }
  } else {
    // Add reaction
    msg.reactions[emoji].push(uid);
  }

  // Update in Firestore
  if (firestoreDb) {
    try {
      await firestoreDb.collection('messages').doc(messageId).update({
        reactions: msg.reactions
      });
    } catch (fsErr) {
      console.warn(`⚠️ [Firestore] Error updating reactions for ${messageId}:`, fsErr.message);
    }
  }

  return msg.reactions;
}

// Mark messages as seen by user (read receipts)
async function markMessagesAsSeen(roomId, messageIds, user) {
  const history = roomHistories.get(roomId) || [];
  const updatedList = [];
  const now = Date.now();

  for (const msgId of messageIds) {
    const msg = history.find(m => m.id === msgId);
    if (!msg) continue;
    if (!msg.seenBy) msg.seenBy = [];

    // Check if user already marked this message as seen
    const alreadySeen = msg.seenBy.some(s => s.uid === user.uid);
    if (!alreadySeen && msg.sender.uid !== user.uid) {
      const seenEntry = {
        uid: user.uid,
        name: user.name,
        seenAt: now
      };
      msg.seenBy.push(seenEntry);
      updatedList.push({ id: msg.id, seenBy: msg.seenBy });

      if (firestoreDb) {
        firestoreDb.collection('messages').doc(msg.id).update({
          seenBy: msg.seenBy
        }).catch(e => console.warn('Firestore seenBy update error:', e.message));
      }
    }
  }

  return updatedList;
}

// Active Users Presence Map: Map<uid, UserProfile>
// UserProfile: { uid, name, email, picture, sockets: Set<socketId>, currentRoom: string, status: 'online' | 'away' | 'studying', lastSeen: number }
const activeUsers = new Map();

// Returns array of publicly visible online users
function getOnlineUsersList() {
  const list = [];
  activeUsers.forEach((user) => {
    list.push({
      uid: user.uid,
      name: user.name,
      email: user.email,
      picture: user.picture,
      status: user.status || 'online',
      currentRoom: user.currentRoom || 'general'
    });
  });
  return list;
}

// ==========================================
// 3. REST API ENDPOINTS
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    activeUsersCount: activeUsers.size,
    firebaseAdminConfigured: isFirebaseAdminReady,
    firestoreDatabaseId: firebaseAppletConfig?.firestoreDatabaseId || null,
    projectId: firebaseAppletConfig?.projectId || null,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/firebase-config', (req, res) => {
  if (firebaseAppletConfig) {
    return res.json(firebaseAppletConfig);
  }
  res.status(404).json({ error: 'Firebase configuration not found' });
});

app.get('/api/channels', (req, res) => {
  const channelsWithStats = CHANNELS.map(channel => {
    // Count how many online users are currently in this channel
    let membersInRoom = 0;
    activeUsers.forEach(u => {
      if (u.currentRoom === channel.id) membersInRoom++;
    });
    return {
      ...channel,
      onlineCount: membersInRoom,
      totalMessages: (roomHistories.get(channel.id) || []).length
    };
  });

  res.json({
    channels: channelsWithStats,
    firebaseAdminReady: isFirebaseAdminReady
  });
});

// ==========================================
// 4. SOCKET.IO SETUP & AUTHENTICATION
// ==========================================
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 5e6, // 5MB buffer for photo and media transfers
  pingTimeout: 30000,
  pingInterval: 25000
});

// Authentication Middleware on Socket.IO Handshake
io.use(async (socket, next) => {
  try {
    const authData = socket.handshake.auth || {};
    const token = authData.token || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    const clientUser = authData.user || null;

    if (!token) {
      return next(new Error('Authentication error: Missing token'));
    }

    const verifiedUser = await verifyAuthToken(token, clientUser);
    socket.user = verifiedUser;
    next();
  } catch (error) {
    console.error(`❌ Socket authentication error from ${socket.id}:`, error.message);
    next(new Error(`Unauthorized: ${error.message}`));
  }
});

// Socket.IO Connection & Event Routing
io.on('connection', async (socket) => {
  const user = socket.user;
  const uid = user.uid;

  console.log(`🔌 [Socket Connected] ${user.name} (${uid}) connected on socket ${socket.id}`);

  // Register in active users map
  if (!activeUsers.has(uid)) {
    activeUsers.set(uid, {
      uid: user.uid,
      name: user.name,
      email: user.email,
      picture: user.picture,
      sockets: new Set([socket.id]),
      currentRoom: 'general',
      status: 'online',
      lastSeen: Date.now()
    });
  } else {
    const existing = activeUsers.get(uid);
    existing.sockets.add(socket.id);
    existing.name = user.name || existing.name;
    existing.picture = user.picture || existing.picture;
  }

  // Join personal user room for targeted notifications (e.g. direct messages)
  socket.join(`user_${uid}`);

  // Join default channel
  const defaultRoom = 'general';
  socket.join(defaultRoom);
  socket.currentRoom = defaultRoom;

  // Fetch last 50 messages from Firestore (or memory) and send initial room history
  const initialHistory = await getRoomMessages(defaultRoom, 50);
  socket.emit('room:history', {
    roomId: defaultRoom,
    messages: initialHistory
  });

  // Broadcast updated presence to all clients
  io.emit('users:presence', getOnlineUsersList());

  // Broadcast system notice that user joined
  socket.to(defaultRoom).emit('system:notice', {
    roomId: defaultRoom,
    text: `${user.name} joined the room`,
    timestamp: Date.now()
  });

  // ------------------------------------------
  // EVENT: user:join_room (School Channel)
  // ------------------------------------------
  socket.on('user:join_room', async ({ roomId }) => {
    if (!roomId) return;

    // Validate channel existence
    const channelExists = CHANNELS.some(c => c.id === roomId);
    if (!channelExists) return;

    const previousRoom = socket.currentRoom;
    if (previousRoom === roomId) {
      // Already in room, re-fetch last 50 messages
      const history = await getRoomMessages(roomId, 50);
      socket.emit('room:history', { roomId, messages: history });
      return;
    }

    // Leave old room
    if (previousRoom) {
      socket.leave(previousRoom);
      socket.to(previousRoom).emit('system:notice', {
        roomId: previousRoom,
        text: `${user.name} left the room`,
        timestamp: Date.now()
      });
    }

    // Join new room
    socket.join(roomId);
    socket.currentRoom = roomId;

    const userProfile = activeUsers.get(uid);
    if (userProfile) {
      userProfile.currentRoom = roomId;
    }

    // Fetch and send last 50 messages
    const history = await getRoomMessages(roomId, 50);
    socket.emit('room:history', { roomId, messages: history });

    // Notify new room members
    socket.to(roomId).emit('system:notice', {
      roomId,
      text: `${user.name} entered #${roomId}`,
      timestamp: Date.now()
    });

    // Update presence so peers see user's active channel
    io.emit('users:presence', getOnlineUsersList());
  });

  // ------------------------------------------
  // EVENT: dm:join (Direct Message Private Chat)
  // ------------------------------------------
  socket.on('dm:join', async ({ targetUid }) => {
    if (!targetUid || targetUid === uid) return;
    const dmRoomId = getDmRoomId(uid, targetUid);

    const previousRoom = socket.currentRoom;
    if (previousRoom && previousRoom !== dmRoomId) {
      socket.leave(previousRoom);
    }

    // Join both sockets of the user to the DM room
    socket.join(dmRoomId);
    socket.currentRoom = dmRoomId;

    const userProfile = activeUsers.get(uid);
    if (userProfile) {
      userProfile.currentRoom = dmRoomId;
    }

    // Also find target user's active sockets and join them to this DM room if online
    const targetProfile = activeUsers.get(targetUid);
    if (targetProfile && targetProfile.sockets) {
      targetProfile.sockets.forEach(sockId => {
        const s = io.sockets.sockets.get(sockId);
        if (s) s.join(dmRoomId);
      });
    }

    // Fetch last 50 messages for this direct message
    const history = await getRoomMessages(dmRoomId, 50);
    socket.emit('room:history', {
      roomId: dmRoomId,
      isDM: true,
      targetUid,
      messages: history
    });

    io.emit('users:presence', getOnlineUsersList());
  });

  // ------------------------------------------
  // EVENT: message:send
  // ------------------------------------------
  socket.on('message:send', async (data) => {
    const { roomId, content, image } = data || {};
    if (!roomId) return;

    const trimmedContent = (typeof content === 'string') ? content.trim() : '';
    const hasImage = typeof image === 'string' && image.startsWith('data:image/') && image.length < 3 * 1024 * 1024;

    // Must have either text content or an image attachment
    if (!trimmedContent && !hasImage) return;
    if (trimmedContent.length > 2000) return;

    const messageObj = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      roomId,
      sender: {
        uid: user.uid,
        name: user.name,
        avatar: user.picture,
        email: user.email
      },
      content: trimmedContent,
      image: hasImage ? image : null,
      timestamp: Date.now(),
      formattedTime: formatTimestamp(Date.now()),
      reactions: {},
      seenBy: []
    };

    // Save to Firestore and local cache
    await saveMessage(messageObj);

    // Broadcast message to everyone in the room (including sender)
    io.to(roomId).emit('message:receive', messageObj);

    // If this is a direct message, notify the recipient outside their active view
    if (roomId.startsWith('dm_')) {
      const uids = roomId.replace('dm_', '').split('_');
      const recipientUid = uids.find(id => id !== user.uid);
      if (recipientUid) {
        io.to(`user_${recipientUid}`).emit('dm:incoming', {
          roomId,
          message: messageObj,
          sender: {
            uid: user.uid,
            name: user.name,
            avatar: user.picture,
            email: user.email
          }
        });
      }
    }
  });

  // ------------------------------------------
  // EVENT: message:react (Emoji Reactions)
  // ------------------------------------------
  socket.on('message:react', async ({ roomId, messageId, emoji }) => {
    if (!roomId || !messageId || !emoji) return;

    const updatedReactions = await updateMessageReactions(roomId, messageId, emoji, user.uid);
    if (updatedReactions !== null) {
      io.to(roomId).emit('message:reaction_update', {
        roomId,
        messageId,
        reactions: updatedReactions
      });
    }
  });

  // ------------------------------------------
  // EVENT: message:read (Read Receipts)
  // ------------------------------------------
  socket.on('message:read', async ({ roomId, messageIds }) => {
    if (!roomId || !Array.isArray(messageIds) || messageIds.length === 0) return;

    const seenUpdates = await markMessagesAsSeen(roomId, messageIds, user);
    if (seenUpdates.length > 0) {
      io.to(roomId).emit('message:seen_update', {
        roomId,
        seenUpdates
      });
    }
  });

  // ------------------------------------------
  // EVENT: typing:start & typing:stop
  // ------------------------------------------
  socket.on('typing:start', ({ roomId }) => {
    if (!roomId) return;
    socket.to(roomId).emit('typing:update', {
      roomId,
      userId: user.uid,
      userName: user.name,
      isTyping: true
    });
  });

  socket.on('typing:stop', ({ roomId }) => {
    if (!roomId) return;
    socket.to(roomId).emit('typing:update', {
      roomId,
      userId: user.uid,
      userName: user.name,
      isTyping: false
    });
  });

  // ------------------------------------------
  // EVENT: status:change (online, away, studying)
  // ------------------------------------------
  socket.on('status:change', ({ status }) => {
    const allowed = ['online', 'away', 'studying'];
    if (!allowed.includes(status)) return;

    const userProfile = activeUsers.get(uid);
    if (userProfile) {
      userProfile.status = status;
      io.emit('users:presence', getOnlineUsersList());
    }
  });

  // ------------------------------------------
  // EVENT: disconnect
  // ------------------------------------------
  socket.on('disconnect', () => {
    console.log(`🔌 [Socket Disconnected] ${user.name} on socket ${socket.id}`);
    const userProfile = activeUsers.get(uid);
    if (userProfile) {
      userProfile.sockets.delete(socket.id);
      if (userProfile.sockets.size === 0) {
        activeUsers.delete(uid);
        // Clear any typing indicator
        if (socket.currentRoom) {
          socket.to(socket.currentRoom).emit('typing:update', {
            roomId: socket.currentRoom,
            userId: user.uid,
            userName: user.name,
            isTyping: false
          });
        }
        // Broadcast presence update
        io.emit('users:presence', getOnlineUsersList());
      }
    }
  });
});

// Fallback to index.html for SPA client navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 CampusConnect Chat Server is running on port ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🔥 Firebase Admin Ready: ${isFirebaseAdminReady}`);
  console.log(`====================================================`);
});
