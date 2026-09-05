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
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Production-grade security headers & response optimization
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Enable CORS for development and cross-origin requests
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// In-Memory Socket Rate Limiter (prevents socket flooding and DoS)
const socketRateLimits = new Map();

function isRateLimited(socketId, maxEvents = 15, windowMs = 3000) {
  const now = Date.now();
  if (!socketRateLimits.has(socketId)) {
    socketRateLimits.set(socketId, { count: 1, resetTime: now + windowMs });
    return false;
  }
  const entry = socketRateLimits.get(socketId);
  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = now + windowMs;
    return false;
  }
  entry.count += 1;
  return entry.count > maxEvents;
}

// Serve static frontend files (CampusConnect client in 'public')
const staticDir = path.join(process.cwd(), 'public');
app.use(express.static(staticDir));

// ==========================================
// 1. FIREBASE ADMIN & FIRESTORE INITIALIZATION
// ==========================================
let isFirebaseAdminReady = false;
let adminAuth = null;
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
      const adminApp = initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      adminAuth = getAuth(adminApp);
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

  if (!adminAuth && firebaseAppletConfig && firebaseAppletConfig.projectId) {
    const adminApp = initializeApp({
      projectId: firebaseAppletConfig.projectId
    });
    adminAuth = getAuth(adminApp);
    isFirebaseAdminReady = true;
    console.log(`✅ [Firebase Auth] Initialized for token verification (Project: ${firebaseAppletConfig.projectId}).`);
  } else if (!adminAuth && (process.env.FIREBASE_CONFIG || process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    const adminApp = initializeApp();
    adminAuth = getAuth(adminApp);
    isFirebaseAdminReady = true;
    try {
      firestoreDb = getFirestore(adminApp);
      console.log('✅ [Firebase Admin] Initialized with environment credentials and Firestore ready.');
    } catch (fsErr) {
      console.warn('⚠️ [Firebase Admin] Could not initialize Firestore:', fsErr.message);
    }
  }

  if (!adminAuth) {
    console.warn('⚠️ [Firebase Admin] No Firebase configuration found. Running in Dev/Demo token mode.');
  }
} catch (err) {
  console.error('❌ [Firebase Admin] Error initializing Admin SDK:', err.message);
  console.warn('⚠️ Falling back to Dev/Demo token mode so the app remains fully usable.');
}

// Graceful Firestore error helper (catches permissions/unavailable errors and safely reverts to in-memory state)
function handleFirestoreError(err, context = '') {
  if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED') || err?.message?.includes('insufficient permissions')) {
    if (firestoreDb) {
      console.info('ℹ️ [Firestore] Service account credentials not present or lack IAM permissions; using robust in-memory state.');
      firestoreDb = null;
    }
  } else {
    console.warn(`⚠️ [Firestore] ${context} error:`, err?.message || err);
  }
}

// Helper to verify Firebase ID Token (Auth-only protection for you and your friends)
async function verifyAuthToken(token, clientUser = null) {
  if (!token) throw new Error('Authentication token is required');

  // Verify genuine Firebase ID Token with Firebase Admin SDK
  if (adminAuth) {
    try {
      const decodedToken = await adminAuth.verifyIdToken(token);
      return {
        uid: decodedToken.uid,
        email: decodedToken.email || '',
        name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Friend',
        picture: decodedToken.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(decodedToken.name || 'Friend')}&background=4f46e5&color=fff`,
        authType: 'firebase-auth'
      };
    } catch (err) {
      if (err.code === 'auth/id-token-expired' || err.message?.includes('id-token-expired')) {
        console.warn('⚠️ [Auth] Client Firebase ID token has expired. Client will auto-refresh.');
      } else {
        console.warn('Token verification error against Firebase Admin:', err.message);
      }
      const wrappedErr = new Error(`Firebase token verification failed: ${err.message}`);
      wrappedErr.code = err.code || 'auth/id-token-expired';
      throw wrappedErr;
    }
  }

  throw new Error('Firebase Authentication is not ready. Please verify Firebase project configuration.');
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

// In-Memory message histories per room (pristine & clean - memory cleared for you and your friends)
const roomHistories = new Map();

// Initialize clean, empty histories for all channels
CHANNELS.forEach(channel => {
  roomHistories.set(channel.id, []);
});

// Helper to format timestamp into 12-hour AM/PM
function formatTimestamp(timestamp = Date.now()) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Clean up any legacy test documents from Firestore if present
async function clearTestFirestoreMessages() {
  if (!firestoreDb) return;
  try {
    const seedDocs = ['msg_seed_1', 'msg_seed_2', 'msg_seed_3', 'msg_seed_4', 'msg_seed_5'];
    for (const id of seedDocs) {
      try {
        await firestoreDb.collection('messages').doc(id).delete();
      } catch (e) {}
    }
    const testUids = ['sys_alex', 'sys_maya', 'sys_jordan'];
    for (const uid of testUids) {
      try {
        await firestoreDb.collection('users').doc(uid).delete();
      } catch (e) {}
    }
    console.log('🧹 [Firestore] Cleared any test/seed documents from database.');
  } catch (err) {
    console.warn('⚠️ Could not clear test Firestore messages:', err.message);
  }
}
clearTestFirestoreMessages();

// Helper to compute deterministic Direct Message Room ID for two users
function getDmRoomId(uid1, uid2) {
  return 'dm_' + [uid1, uid2].sort().join('_');
}

// ==========================================
// FIRESTORE & IN-MEMORY MESSAGE HELPERS
// ==========================================

// Save a new message to in-memory cache synchronously (0ms latency lookup)
function saveMessageToMemory(messageObj) {
  const { roomId } = messageObj;
  if (!roomHistories.has(roomId)) {
    roomHistories.set(roomId, []);
  }
  const history = roomHistories.get(roomId);
  history.push(messageObj);
  // Cap at 150 items to keep memory strictly bounded and prevent leaks
  if (history.length > 150) {
    history.shift();
  }
}

// Persist message asynchronously to Firestore in the background (non-blocking)
async function saveMessageToFirestore(messageObj) {
  if (!firestoreDb) return;
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
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (fsErr) {
    handleFirestoreError(fsErr, `Failed to persist message ${messageObj.id}`);
  }
}

// Combined helper for backward compatibility
async function saveMessage(messageObj) {
  saveMessageToMemory(messageObj);
  return saveMessageToFirestore(messageObj);
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
      handleFirestoreError(fsErr, `Message history fetch for ${roomId}`);
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
      handleFirestoreError(fsErr, `Error updating reactions for ${messageId}`);
    }
  }

  return msg.reactions;
}

// Mark messages as seen by user (read receipts tied to individual messages)
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
        picture: user.picture || null,
        seenAt: now
      };
      msg.seenBy.push(seenEntry);
      updatedList.push({
        id: msg.id,
        messageId: msg.id,
        roomId,
        seenBy: msg.seenBy,
        senderUid: msg.sender?.uid,
        readBy: seenEntry
      });

      if (firestoreDb) {
        firestoreDb.collection('messages').doc(msg.id).update({
          seenBy: msg.seenBy
        }).catch(e => handleFirestoreError(e, 'seenBy update'));
      }
    }
  }

  return updatedList;
}

// ==========================================
// 2B. ADMIN, MODERATION & AUDIT LOG STATE
// ==========================================
// Designated Super-Admin / Owner email from environment credentials
const OWNER_EMAIL = 'sianbirmaken.svkm@gmail.com';

// Map<uid, 'admin' | 'moderator' | 'student'>
const userRoles = new Map();
// Set of muted uids: Set<uid>
const mutedUsers = new Set();
// Set of banned uids: Set<uid>
const bannedUsers = new Set();
// Audit log entries: Array<{ id, action, actorUid, actorName, details, timestamp }>
const auditLogs = [];
// Active campus-wide system announcement
let activeSystemBroadcast = null;

// Determine authoritative role for a given user
function getUserRole(uid, email = '') {
  if (email && email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
    return 'admin';
  }
  return userRoles.get(uid) || 'student';
}

// Check if user has staff privileges (Admin or Moderator)
function isUserStaff(uid, email = '') {
  const role = getUserRole(uid, email);
  return role === 'admin' || role === 'moderator';
}

// Check if user has primary Administrator privileges
function isUserAdmin(uid, email = '') {
  return getUserRole(uid, email) === 'admin';
}

// Record an administrative or moderation action in audit trail
async function recordAuditLog(action, actorUser, details) {
  const logEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    action,
    actorUid: actorUser?.uid || 'system',
    actorName: actorUser?.name || actorUser?.email || 'Campus Administrator',
    details,
    timestamp: Date.now()
  };
  auditLogs.unshift(logEntry);
  if (auditLogs.length > 200) auditLogs.pop();

  if (firestoreDb) {
    try {
      await firestoreDb.collection('audit_logs').doc(logEntry.id).set(logEntry);
    } catch (e) {
      handleFirestoreError(e, 'Save audit log');
    }
  }
  return logEntry;
}

// Helper to delete a message across memory and Firestore
async function deleteMessage(messageId, roomId = null) {
  let targetRoomId = roomId;
  if (!targetRoomId) {
    for (const [rId, msgs] of roomHistories.entries()) {
      const idx = msgs.findIndex(m => m.id === messageId);
      if (idx !== -1) {
        targetRoomId = rId;
        msgs.splice(idx, 1);
        break;
      }
    }
  } else {
    const msgs = roomHistories.get(targetRoomId) || [];
    const idx = msgs.findIndex(m => m.id === messageId);
    if (idx !== -1) {
      msgs.splice(idx, 1);
    }
  }

  if (firestoreDb) {
    try {
      await firestoreDb.collection('messages').doc(messageId).delete();
    } catch (e) {
      handleFirestoreError(e, `Delete message ${messageId}`);
    }
  }

  return targetRoomId;
}

// Helper to purge room history
async function purgeChannelHistory(channelId) {
  roomHistories.set(channelId, []);

  if (firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('messages')
        .where('roomId', '==', channelId)
        .limit(300)
        .get();

      if (!snapshot.empty) {
        const batch = firestoreDb.batch();
        snapshot.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      }
    } catch (e) {
      handleFirestoreError(e, `Purge channel ${channelId}`);
    }
  }
}

// Map<uid, { uid, name, picture, email, role, isMuted, isBanned, updatedAt }>
const savedProfiles = new Map();

// Helper to save and sync user profile in memory and Firestore
async function saveUserProfile(uid, profileData) {
  const existing = savedProfiles.get(uid) || {};
  const userEmail = profileData.email || existing.email || '';
  const role = profileData.role || getUserRole(uid, userEmail);
  const isMuted = profileData.isMuted !== undefined ? profileData.isMuted : mutedUsers.has(uid);
  const isBanned = profileData.isBanned !== undefined ? profileData.isBanned : bannedUsers.has(uid);

  const updated = {
    ...existing,
    ...profileData,
    uid,
    role,
    isMuted,
    isBanned,
    updatedAt: Date.now()
  };
  savedProfiles.set(uid, updated);

  // Update in activeUsers presence map if user is currently connected
  const activeUser = activeUsers.get(uid);
  if (activeUser) {
    if (updated.name) activeUser.name = updated.name;
    if (updated.picture !== undefined) activeUser.picture = updated.picture;
    activeUser.role = role;
    activeUser.isMuted = isMuted;
    activeUser.isBanned = isBanned;
  }

  // Update sender avatar and name in cached room histories
  for (const [roomId, history] of roomHistories.entries()) {
    for (const m of history) {
      if (m.sender && m.sender.uid === uid) {
        if (updated.name) m.sender.name = updated.name;
        if (updated.picture !== undefined) m.sender.avatar = updated.picture;
      }
    }
  }

  // Persist to Firestore /users/{uid}
  if (firestoreDb) {
    try {
      await firestoreDb.collection('users').doc(uid).set({
        uid,
        name: updated.name,
        picture: updated.picture || null,
        email: updated.email || activeUser?.email || '',
        role: updated.role,
        isMuted: updated.isMuted,
        isBanned: updated.isBanned,
        status: activeUser?.status || 'online',
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      console.log(`💾 [Firestore] Saved user profile for ${uid} (${updated.name}) [${role}]`);
    } catch (fsErr) {
      handleFirestoreError(fsErr, `User profile update for ${uid}`);
    }
  }

  return updated;
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
      currentRoom: user.currentRoom || 'general',
      role: getUserRole(user.uid, user.email),
      isMuted: mutedUsers.has(user.uid),
      isBanned: bannedUsers.has(user.uid)
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

// Profile Update Endpoint
app.post('/api/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const clientUser = req.body.clientUser || null;
    const verifiedUser = await verifyAuthToken(token, clientUser);

    const { name, picture } = req.body;
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 80) {
      return res.status(400).json({ error: 'Display name must be between 2 and 80 characters' });
    }

    const cleanedPicture = (typeof picture === 'string' && picture.trim().length > 0)
      ? picture.trim()
      : null;

    const updatedProfile = await saveUserProfile(verifiedUser.uid, {
      name: trimmedName,
      picture: cleanedPicture,
      email: verifiedUser.email
    });

    // Real-time broadcast to all connected clients
    io.emit('user:profile_updated', {
      uid: verifiedUser.uid,
      name: trimmedName,
      picture: cleanedPicture,
      updatedAt: Date.now()
    });

    // Broadcast updated presence
    io.emit('users:presence', getOnlineUsersList());

    res.json({
      success: true,
      profile: updatedProfile
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update profile' });
  }
});

// Profile Fetch Endpoint
app.get('/api/profile/:uid', async (req, res) => {
  const targetUid = req.params.uid;
  if (!targetUid) return res.status(400).json({ error: 'UID required' });

  if (savedProfiles.has(targetUid)) {
    return res.json(savedProfiles.get(targetUid));
  }

  if (firestoreDb) {
    try {
      const doc = await firestoreDb.collection('users').doc(targetUid).get();
      if (doc.exists) {
        return res.json(doc.data());
      }
    } catch (e) {
      handleFirestoreError(e, `Fetch profile for ${targetUid}`);
    }
  }

  const active = activeUsers.get(targetUid);
  if (active) {
    return res.json({
      uid: active.uid,
      name: active.name,
      picture: active.picture,
      email: active.email,
      status: active.status
    });
  }

  res.status(404).json({ error: 'Profile not found' });
});

// Clear All Memory Endpoint
app.post('/api/clear-memory', async (req, res) => {
  try {
    CHANNELS.forEach(channel => {
      roomHistories.set(channel.id, []);
    });
    // Remove all direct message histories from memory
    for (const key of Array.from(roomHistories.keys())) {
      if (key.startsWith('dm_')) {
        roomHistories.delete(key);
      }
    }
    // Also trigger Firestore test message cleanup
    await clearTestFirestoreMessages();
    io.emit('room:history_cleared', { timestamp: Date.now() });
    res.json({ success: true, message: 'All in-memory histories cleared successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 3B. ADMIN & MODERATION API ROUTES
// ==========================================

// Middleware: Authenticate and require staff role (admin or moderator)
async function requireStaffAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const clientUser = req.body?.clientUser || (req.query?.clientUser ? JSON.parse(req.query.clientUser) : null);
    const verifiedUser = await verifyAuthToken(token, clientUser);

    if (!isUserStaff(verifiedUser.uid, verifiedUser.email)) {
      return res.status(403).json({ error: 'Permission denied: Staff access required.' });
    }
    req.staffUser = verifiedUser;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: ' + (err.message || 'Authentication required') });
  }
}

// Middleware: Authenticate and require primary administrator role
async function requireAdminAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const clientUser = req.body?.clientUser || (req.query?.clientUser ? JSON.parse(req.query.clientUser) : null);
    const verifiedUser = await verifyAuthToken(token, clientUser);

    if (!isUserAdmin(verifiedUser.uid, verifiedUser.email)) {
      return res.status(403).json({ error: 'Permission denied: Administrator privileges required.' });
    }
    req.adminUser = verifiedUser;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: ' + (err.message || 'Authentication required') });
  }
}

// 1. Admin Telemetry & System Overview
app.get('/api/admin/overview', requireStaffAuth, (req, res) => {
  let totalMessagesCount = 0;
  roomHistories.forEach(list => {
    totalMessagesCount += list.length;
  });

  const channelsStats = CHANNELS.map(ch => {
    const msgs = roomHistories.get(ch.id) || [];
    let occupants = 0;
    activeUsers.forEach(u => {
      if (u.currentRoom === ch.id) occupants++;
    });
    return {
      ...ch,
      messageCount: msgs.length,
      occupantsCount: occupants,
      isLocked: Boolean(ch.isLocked)
    };
  });

  res.json({
    stats: {
      totalMembers: Math.max(savedProfiles.size, activeUsers.size, 1),
      activeOnline: activeUsers.size,
      totalMessages: totalMessagesCount,
      channelsCount: CHANNELS.length,
      uptimeSeconds: Math.floor(process.uptime()),
      mutedCount: mutedUsers.size,
      bannedCount: bannedUsers.size,
      firebaseReady: isFirebaseAdminReady,
      firestoreDbId: firebaseAppletConfig?.firestoreDatabaseId || 'default'
    },
    channels: channelsStats,
    recentAuditLogs: auditLogs.slice(0, 30),
    activeBroadcast: activeSystemBroadcast
  });
});

// 2. Member Management: Get all known members with roles and activity
app.get('/api/admin/members', requireStaffAuth, async (req, res) => {
  const membersMap = new Map();

  // Populate from savedProfiles
  savedProfiles.forEach((profile, uid) => {
    membersMap.set(uid, {
      uid: profile.uid,
      name: profile.name,
      email: profile.email,
      picture: profile.picture,
      role: getUserRole(uid, profile.email),
      isMuted: mutedUsers.has(uid),
      isBanned: bannedUsers.has(uid),
      status: 'offline',
      lastSeen: profile.updatedAt || Date.now()
    });
  });

  // Overlay with active connected users
  activeUsers.forEach((user, uid) => {
    const existing = membersMap.get(uid) || {};
    membersMap.set(uid, {
      ...existing,
      uid,
      name: user.name || existing.name || 'Classmate',
      email: user.email || existing.email || '',
      picture: user.picture || existing.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'Friend')}&background=4f46e5&color=fff`,
      role: getUserRole(uid, user.email || existing.email),
      isMuted: mutedUsers.has(uid),
      isBanned: bannedUsers.has(uid),
      status: user.status || 'online',
      currentRoom: user.currentRoom || 'general',
      lastSeen: Date.now()
    });
  });

  // Calculate message count per member
  const msgCounts = new Map();
  roomHistories.forEach((msgs) => {
    msgs.forEach((m) => {
      const senderUid = m.sender?.uid;
      if (senderUid) {
        msgCounts.set(senderUid, (msgCounts.get(senderUid) || 0) + 1);
      }
    });
  });

  const membersList = Array.from(membersMap.values()).map(m => ({
    ...m,
    messageCount: msgCounts.get(m.uid) || 0,
    isOwner: Boolean(m.email && m.email.toLowerCase() === OWNER_EMAIL.toLowerCase())
  }));

  res.json({ members: membersList });
});

// 3. Member Role Assignment
app.post('/api/admin/members/role', requireAdminAuth, async (req, res) => {
  try {
    const { targetUid, role } = req.body;
    if (!targetUid || !role) {
      return res.status(400).json({ error: 'targetUid and role are required' });
    }
    if (!['admin', 'moderator', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role specified' });
    }

    const memberProfile = savedProfiles.get(targetUid) || activeUsers.get(targetUid);
    if (memberProfile?.email && memberProfile.email.toLowerCase() === OWNER_EMAIL.toLowerCase() && role !== 'admin') {
      return res.status(400).json({ error: 'Primary owner role cannot be changed' });
    }

    userRoles.set(targetUid, role);
    await saveUserProfile(targetUid, { role });

    await recordAuditLog('ROLE_CHANGE', req.adminUser, `Changed role of user ${targetUid} (${memberProfile?.name || 'User'}) to ${role}`);

    io.emit('user:role_updated', { uid: targetUid, role });
    io.emit('users:presence', getOnlineUsersList());

    res.json({ success: true, targetUid, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Mute / Unmute Member
app.post('/api/admin/members/mute', requireStaffAuth, async (req, res) => {
  try {
    const { targetUid, muted, reason } = req.body;
    if (!targetUid) return res.status(400).json({ error: 'targetUid is required' });

    const memberProfile = savedProfiles.get(targetUid) || activeUsers.get(targetUid);
    if (memberProfile?.email && memberProfile.email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot mute primary campus administrator' });
    }

    if (muted) {
      mutedUsers.add(targetUid);
    } else {
      mutedUsers.delete(targetUid);
    }

    await saveUserProfile(targetUid, { isMuted: Boolean(muted) });
    await recordAuditLog(muted ? 'MUTE_USER' : 'UNMUTE_USER', req.staffUser, `${muted ? 'Muted' : 'Unmuted'} ${memberProfile?.name || targetUid}${reason ? ` (Reason: ${reason})` : ''}`);

    io.to(`user_${targetUid}`).emit('admin:user_muted_status', {
      isMuted: Boolean(muted),
      reason: reason || (muted ? 'You have been muted by a staff member.' : 'Your mute restriction has been removed.')
    });

    io.emit('users:presence', getOnlineUsersList());
    res.json({ success: true, targetUid, isMuted: Boolean(muted) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Kick Active Session
app.post('/api/admin/members/kick', requireStaffAuth, async (req, res) => {
  try {
    const { targetUid, reason } = req.body;
    if (!targetUid) return res.status(400).json({ error: 'targetUid is required' });

    const memberProfile = savedProfiles.get(targetUid) || activeUsers.get(targetUid);
    if (memberProfile?.email && memberProfile.email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot kick primary campus administrator' });
    }

    const active = activeUsers.get(targetUid);
    if (active && active.sockets) {
      active.sockets.forEach(socketId => {
        const targetSocket = io.sockets.sockets.get(socketId);
        if (targetSocket) {
          targetSocket.emit('auth:kicked', {
            reason: reason || 'You were disconnected by a campus administrator.'
          });
          targetSocket.disconnect(true);
        }
      });
      activeUsers.delete(targetUid);
    }

    await recordAuditLog('KICK_USER', req.staffUser, `Kicked active session for ${memberProfile?.name || targetUid}${reason ? ` (Reason: ${reason})` : ''}`);
    io.emit('users:presence', getOnlineUsersList());

    res.json({ success: true, targetUid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Ban / Unban User Account
app.post('/api/admin/members/ban', requireAdminAuth, async (req, res) => {
  try {
    const { targetUid, banned, reason } = req.body;
    if (!targetUid) return res.status(400).json({ error: 'targetUid is required' });

    const memberProfile = savedProfiles.get(targetUid) || activeUsers.get(targetUid);
    if (memberProfile?.email && memberProfile.email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot ban primary campus administrator' });
    }

    if (banned) {
      bannedUsers.add(targetUid);
      // Disconnect all active sockets
      const active = activeUsers.get(targetUid);
      if (active && active.sockets) {
        active.sockets.forEach(socketId => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket) {
            targetSocket.emit('auth:banned', {
              reason: reason || 'Your account has been suspended by an administrator.'
            });
            targetSocket.disconnect(true);
          }
        });
        activeUsers.delete(targetUid);
      }
    } else {
      bannedUsers.delete(targetUid);
    }

    await saveUserProfile(targetUid, { isBanned: Boolean(banned) });
    await recordAuditLog(banned ? 'BAN_USER' : 'UNBAN_USER', req.adminUser, `${banned ? 'Suspended' : 'Unbanned'} user account ${memberProfile?.name || targetUid}${reason ? ` (Reason: ${reason})` : ''}`);

    io.emit('users:presence', getOnlineUsersList());
    res.json({ success: true, targetUid, isBanned: Boolean(banned) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Channel Management: Create New Channel
app.post('/api/admin/channels/create', requireStaffAuth, async (req, res) => {
  try {
    const { name, topic, icon } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Channel name is required' });
    }

    const cleanSlug = name.toLowerCase().replace(/^#+/, '').trim().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-');
    if (!cleanSlug || cleanSlug.length < 2) {
      return res.status(400).json({ error: 'Valid alphanumeric channel slug required' });
    }

    if (CHANNELS.some(c => c.id === cleanSlug)) {
      return res.status(400).json({ error: `Channel #${cleanSlug} already exists` });
    }

    const newChannel = {
      id: cleanSlug,
      name: `#${cleanSlug}`,
      topic: (typeof topic === 'string' && topic.trim()) ? topic.trim() : 'Campus discussions',
      icon: (typeof icon === 'string' && icon.trim()) ? icon.trim() : 'message-square',
      isLocked: false
    };

    CHANNELS.push(newChannel);
    roomHistories.set(newChannel.id, []);

    // Persist to Firestore /channels/{channelId}
    if (firestoreDb) {
      try {
        await firestoreDb.collection('channels').doc(newChannel.id).set(newChannel);
      } catch (e) {
        handleFirestoreError(e, `Create channel ${newChannel.id}`);
      }
    }

    // Join all active sockets to this new channel
    io.sockets.sockets.forEach(sock => {
      sock.join(newChannel.id);
    });

    await recordAuditLog('CREATE_CHANNEL', req.staffUser, `Created channel #${newChannel.id} (${newChannel.topic})`);
    io.emit('channel:created', newChannel);

    res.json({ success: true, channel: newChannel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Channel Management: Edit Channel Topic / Name
app.post('/api/admin/channels/edit', requireStaffAuth, async (req, res) => {
  try {
    const { channelId, topic, name } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const channel = CHANNELS.find(c => c.id === channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    if (typeof topic === 'string') channel.topic = topic.trim();
    if (typeof name === 'string' && name.trim()) {
      channel.name = name.startsWith('#') ? name.trim() : `#${name.trim()}`;
    }

    if (firestoreDb) {
      try {
        await firestoreDb.collection('channels').doc(channelId).set(channel, { merge: true });
      } catch (e) {
        handleFirestoreError(e, `Update channel ${channelId}`);
      }
    }

    await recordAuditLog('EDIT_CHANNEL', req.staffUser, `Updated channel #${channel.id} details`);
    io.emit('channel:updated', channel);

    res.json({ success: true, channel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Channel Management: Lock / Unlock Channel (Read-Only Mode)
app.post('/api/admin/channels/lock', requireStaffAuth, async (req, res) => {
  try {
    const { channelId, locked } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const channel = CHANNELS.find(c => c.id === channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    channel.isLocked = Boolean(locked);

    if (firestoreDb) {
      try {
        await firestoreDb.collection('channels').doc(channelId).set({ isLocked: channel.isLocked }, { merge: true });
      } catch (e) {
        handleFirestoreError(e, `Lock channel ${channelId}`);
      }
    }

    await recordAuditLog(channel.isLocked ? 'LOCK_CHANNEL' : 'UNLOCK_CHANNEL', req.staffUser, `${channel.isLocked ? 'Locked' : 'Unlocked'} #${channel.id} (Read-only mode: ${channel.isLocked})`);
    io.emit('channel:lock_status', { channelId, isLocked: channel.isLocked });

    res.json({ success: true, channelId, isLocked: channel.isLocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Channel Management: Purge Channel History
app.post('/api/admin/channels/purge', requireAdminAuth, async (req, res) => {
  try {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const channel = CHANNELS.find(c => c.id === channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    await purgeChannelHistory(channelId);
    await recordAuditLog('PURGE_CHANNEL', req.adminUser, `Purged all chat messages from channel #${channelId}`);

    io.to(channelId).emit('room:history_cleared', { roomId: channelId, timestamp: Date.now() });

    res.json({ success: true, channelId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Channel Management: Delete Custom Channel
app.delete('/api/admin/channels/:channelId', requireAdminAuth, async (req, res) => {
  try {
    const { channelId } = req.params;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });
    if (channelId === 'general') {
      return res.status(400).json({ error: 'Cannot delete the default #general channel' });
    }

    const index = CHANNELS.findIndex(c => c.id === channelId);
    if (index === -1) return res.status(404).json({ error: 'Channel not found' });

    CHANNELS.splice(index, 1);
    roomHistories.delete(channelId);

    if (firestoreDb) {
      try {
        await firestoreDb.collection('channels').doc(channelId).delete();
      } catch (e) {
        handleFirestoreError(e, `Delete channel ${channelId}`);
      }
    }

    await recordAuditLog('DELETE_CHANNEL', req.adminUser, `Deleted channel #${channelId}`);
    io.emit('channel:deleted', { channelId });

    res.json({ success: true, channelId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11.5 Campus Lockdown (Lock all channels)
app.post('/api/admin/campus/lockdown', requireAdminAuth, async (req, res) => {
  try {
    const batch = firestoreDb ? firestoreDb.batch() : null;
    let lockCount = 0;

    for (const channel of CHANNELS) {
      if (!channel.isLocked) {
        channel.isLocked = true;
        lockCount++;
        if (batch) {
          const ref = firestoreDb.collection('channels').doc(channel.id);
          batch.update(ref, { isLocked: true });
        }
        // Emit lock status for each channel to update clients instantly
        io.emit('channel:lock_status', { channelId: channel.id, isLocked: true });
        // The channel:locked event is also listened to by the client
        io.emit('channel:locked', { channelId: channel.id, isLocked: true, topic: channel.topic });
      }
    }

    if (batch && lockCount > 0) {
      try {
        await batch.commit();
      } catch (e) {
        console.warn('Firestore lockdown batch commit warning:', e);
      }
    }

    await recordAuditLog('LOCK_CHANNEL', req.adminUser, `🚨 Initiated Global Campus Lockdown. Locked ${lockCount} channels.`);
    
    // Announce via broadcast as well
    const broadcast = {
      title: 'CAMPUS LOCKDOWN',
      message: 'A campus lockdown has been initiated by administrators. All channels are now in read-only mode.',
      priority: 'critical',
      timestamp: Date.now()
    };
    activeSystemBroadcast = broadcast;
    io.emit('admin:system_broadcast', broadcast);

    res.json({ success: true, lockedChannels: lockCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11.6 Campus Unlock (Unlock all channels)
app.post('/api/admin/campus/unlock', requireAdminAuth, async (req, res) => {
  try {
    const batch = firestoreDb ? firestoreDb.batch() : null;
    let unlockCount = 0;

    for (const channel of CHANNELS) {
      if (channel.isLocked) {
        channel.isLocked = false;
        unlockCount++;
        if (batch) {
          const ref = firestoreDb.collection('channels').doc(channel.id);
          batch.update(ref, { isLocked: false });
        }
        // Emit lock status for each channel to update clients instantly
        io.emit('channel:lock_status', { channelId: channel.id, isLocked: false });
        // The channel:locked event is also listened to by the client
        io.emit('channel:locked', { channelId: channel.id, isLocked: false, topic: channel.topic });
      }
    }

    if (batch && unlockCount > 0) {
      try {
        await batch.commit();
      } catch (e) {
        console.warn('Firestore unlock batch commit warning:', e);
      }
    }

    await recordAuditLog('UNLOCK_CHANNEL', req.adminUser, `🔓 Initiated Global Campus Unlock. Unlocked ${unlockCount} channels.`);
    
    // Clear broadcast if it's the lockdown one
    if (activeSystemBroadcast && activeSystemBroadcast.title === 'CAMPUS LOCKDOWN') {
      activeSystemBroadcast = null;
      io.emit('admin:system_broadcast', null);
    } else {
      // Just announce it's lifted
      const broadcast = {
        title: 'CAMPUS UNLOCKED',
        message: 'The campus lockdown has been lifted by administrators. All channels are now unlocked.',
        priority: 'info',
        timestamp: Date.now()
      };
      activeSystemBroadcast = broadcast;
      io.emit('admin:system_broadcast', broadcast);
    }

    res.json({ success: true, unlockedChannels: unlockCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Message Moderation: Search & List Messages
app.get('/api/admin/messages', requireStaffAuth, (req, res) => {
  const { roomId, query, limit = 50 } = req.query;
  const maxLimit = Math.min(parseInt(limit) || 50, 100);

  let pool = [];
  if (roomId && roomHistories.has(roomId)) {
    pool = [...roomHistories.get(roomId)];
  } else {
    roomHistories.forEach(msgs => {
      pool.push(...msgs);
    });
  }

  // Sort descending
  pool.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (query && typeof query === 'string' && query.trim()) {
    const q = query.trim().toLowerCase();
    pool = pool.filter(m => 
      (m.content && m.content.toLowerCase().includes(q)) ||
      (m.sender?.name && m.sender.name.toLowerCase().includes(q)) ||
      (m.sender?.email && m.sender.email.toLowerCase().includes(q))
    );
  }

  res.json({ messages: pool.slice(0, maxLimit) });
});

// 13. Message Moderation: Delete Violating Message
app.delete('/api/admin/messages/:messageId', requireStaffAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { roomId } = req.query;
    if (!messageId) return res.status(400).json({ error: 'messageId is required' });

    const targetRoomId = await deleteMessage(messageId, roomId);

    await recordAuditLog('DELETE_MESSAGE', req.staffUser, `Deleted message ${messageId} in room ${targetRoomId || 'general'}`);
    io.emit('message:deleted', { messageId, roomId: targetRoomId });

    res.json({ success: true, messageId, roomId: targetRoomId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Message Moderation: Pin / Unpin Announcement Message
app.post('/api/admin/messages/pin', requireStaffAuth, async (req, res) => {
  try {
    const { messageId, roomId, pinned } = req.body;
    if (!messageId || !roomId) return res.status(400).json({ error: 'messageId and roomId required' });

    const history = roomHistories.get(roomId) || [];
    const msg = history.find(m => m.id === messageId);
    if (msg) {
      msg.isPinned = Boolean(pinned);
    }

    if (firestoreDb) {
      try {
        await firestoreDb.collection('messages').doc(messageId).set({ isPinned: Boolean(pinned) }, { merge: true });
      } catch (e) {
        handleFirestoreError(e, `Pin message ${messageId}`);
      }
    }

    await recordAuditLog(pinned ? 'PIN_MESSAGE' : 'UNPIN_MESSAGE', req.staffUser, `${pinned ? 'Pinned' : 'Unpinned'} message in #${roomId}`);
    io.to(roomId).emit('message:pinned_update', { messageId, roomId, isPinned: Boolean(pinned) });

    res.json({ success: true, messageId, roomId, isPinned: Boolean(pinned) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Campus Announcement System Broadcast
app.post('/api/admin/broadcast', requireStaffAuth, async (req, res) => {
  try {
    const { title, message, priority, active } = req.body;

    if (active === false) {
      activeSystemBroadcast = null;
      await recordAuditLog('CLEAR_BROADCAST', req.staffUser, 'Cleared active campus broadcast banner');
      io.emit('admin:system_broadcast', null);
      return res.json({ success: true, broadcast: null });
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Broadcast message body is required' });
    }

    activeSystemBroadcast = {
      id: `bc_${Date.now()}`,
      title: (title && typeof title === 'string') ? title.trim() : 'Official Campus Announcement',
      message: message.trim(),
      priority: ['info', 'warning', 'urgent', 'celebration'].includes(priority) ? priority : 'info',
      createdAt: Date.now(),
      authorName: req.staffUser?.name || 'Campus Administration'
    };

    await recordAuditLog('SEND_BROADCAST', req.staffUser, `Published broadcast: "${activeSystemBroadcast.title}" (${activeSystemBroadcast.priority.toUpperCase()})`);
    io.emit('admin:system_broadcast', activeSystemBroadcast);

    res.json({ success: true, broadcast: activeSystemBroadcast });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. Audit Log History
app.get('/api/admin/audit-logs', requireStaffAuth, (req, res) => {
  res.json({ auditLogs });
});

// ==========================================
// 4. SOCKET.IO SETUP & AUTHENTICATION
// ==========================================
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'], // Prefer direct WebSockets for zero latency
  perMessageDeflate: {
    threshold: 1024 // Compress payloads over 1KB for faster network transfer
  },
  maxHttpBufferSize: 5e6, // 5MB buffer for photo and media transfers
  pingTimeout: 20000,
  pingInterval: 10000
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
    if (error.code === 'auth/id-token-expired' || error.message?.includes('id-token-expired')) {
      console.warn(`⚠️ Socket connection refused from ${socket.id}: Firebase ID token expired. Client will auto-refresh.`);
    } else {
      console.error(`❌ Socket authentication error from ${socket.id}:`, error.message);
    }
    const authErr = new Error(`Unauthorized: ${error.message}`);
    authErr.data = { code: error.code || 'auth/id-token-expired' };
    next(authErr);
  }
});

// Socket.IO Connection & Event Routing
io.on('connection', async (socket) => {
  const user = socket.user;
  const uid = user.uid;

  console.log(`🔌 [Socket Connected] ${user.name} (${uid}) connected on socket ${socket.id}`);

  // Check if there is a saved custom profile in memory or Firestore
  if (savedProfiles.has(uid)) {
    const saved = savedProfiles.get(uid);
    if (saved.name) user.name = saved.name;
    if (saved.picture !== undefined) user.picture = saved.picture;
  } else if (firestoreDb) {
    try {
      const userDoc = await firestoreDb.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        if (data.name) user.name = data.name;
        if (data.picture !== undefined) user.picture = data.picture;
        savedProfiles.set(uid, { uid, name: user.name, picture: user.picture, email: user.email });
      }
    } catch (e) {
      handleFirestoreError(e, 'Fetch user profile on connect');
    }
  }

  // Check if account is banned
  if (bannedUsers.has(uid)) {
    socket.emit('auth:banned', { reason: 'Your campus account has been suspended by an administrator.' });
    socket.disconnect(true);
    return;
  }

  // Register in active users map
  const userRole = getUserRole(uid, user.email);
  if (!activeUsers.has(uid)) {
    activeUsers.set(uid, {
      uid: user.uid,
      name: user.name,
      email: user.email,
      picture: user.picture,
      sockets: new Set([socket.id]),
      currentRoom: 'general',
      status: 'online',
      role: userRole,
      isMuted: mutedUsers.has(uid),
      isBanned: false,
      lastSeen: Date.now()
    });
  } else {
    const existing = activeUsers.get(uid);
    existing.sockets.add(socket.id);
    existing.name = user.name || existing.name;
    existing.picture = user.picture || existing.picture;
    existing.role = userRole;
    existing.isMuted = mutedUsers.has(uid);
  }

  // Sync profile data back to client including administrative role
  socket.emit('user:profile_sync', {
    uid: user.uid,
    name: user.name,
    picture: user.picture,
    role: userRole,
    isMuted: mutedUsers.has(uid),
    isBanned: false
  });

  // Sync any active campus announcement broadcast
  if (activeSystemBroadcast) {
    socket.emit('admin:system_broadcast', activeSystemBroadcast);
  }

  // Join personal user room for targeted notifications (e.g. direct messages)
  socket.join(`user_${uid}`);

  // Join all school channels so that every online classmate receives live message broadcasts
  // and dynamic unread badge counts for channels they are not currently viewing!
  CHANNELS.forEach(channel => {
    socket.join(channel.id);
  });

  // Join default channel
  const defaultRoom = 'general';
  socket.currentRoom = defaultRoom;

  // Compute initial unread counts per channel for this connected user
  const initialUnreads = {};
  CHANNELS.forEach(channel => {
    if (channel.id === defaultRoom) {
      initialUnreads[channel.id] = 0;
    } else {
      const msgs = roomHistories.get(channel.id) || [];
      const unread = msgs.filter(m => 
        m.sender?.uid !== user.uid && 
        (!m.seenBy || !m.seenBy.some(s => s.uid === user.uid))
      ).length;
      initialUnreads[channel.id] = unread;
    }
  });
  socket.emit('channels:unread_sync', { unreadCounts: initialUnreads });

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

    // If previous room was a private DM room, leave it
    if (previousRoom && previousRoom.startsWith('dm_')) {
      socket.leave(previousRoom);
    }
    // Note: School channels remain joined so cross-channel unread badges update in real time!

    // Ensure socket is in the target room
    socket.join(roomId);
    socket.currentRoom = roomId;

    const userProfile = activeUsers.get(uid);
    if (userProfile) {
      userProfile.currentRoom = roomId;
    }

    // Fetch and send last 50 messages
    const history = await getRoomMessages(roomId, 50);
    socket.emit('room:history', { roomId, messages: history });

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
    if (previousRoom && previousRoom.startsWith('dm_') && previousRoom !== dmRoomId) {
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
    // 0. Account Ban & Mute Moderation Enforcements
    if (bannedUsers.has(user.uid)) {
      socket.emit('auth:banned', { reason: 'Your campus account has been suspended by an administrator.' });
      socket.disconnect(true);
      return;
    }

    if (mutedUsers.has(user.uid)) {
      socket.emit('system:notice', {
        roomId: data?.roomId || 'general',
        text: '🔇 You are currently muted by campus staff and cannot send messages.',
        timestamp: Date.now()
      });
      return;
    }

    // Rate limit check: max 12 messages per 4 seconds per socket
    if (isRateLimited(socket.id, 12, 4000)) {
      socket.emit('system:notice', {
        roomId: data?.roomId || 'general',
        text: '⚠️ You are sending messages too quickly. Please wait a moment.',
        timestamp: Date.now()
      });
      return;
    }

    const { roomId, content, image, clientTempId } = data || {};
    if (!roomId) return;

    // Check if channel is locked (read-only for non-staff)
    const targetChannel = CHANNELS.find(c => c.id === roomId);
    if (targetChannel && targetChannel.isLocked && !isUserStaff(user.uid, user.email)) {
      socket.emit('system:notice', {
        roomId,
        text: `🔒 #${targetChannel.id} is currently locked by staff. New messages are restricted to administrators & moderators.`,
        timestamp: Date.now()
      });
      return;
    }

    let trimmedContent = (typeof content === 'string') ? content.trim() : '';
    const hasImage = typeof image === 'string' && image.startsWith('data:image/') && image.length < 3 * 1024 * 1024;

    // Must have either text content or an image attachment
    if (!trimmedContent && !hasImage) return;
    if (trimmedContent.length > 2000) return;

    // --- Interactive Chat Commands (Arcade) ---
    if (trimmedContent === '/roll') {
      const rollResult = Math.floor(Math.random() * 100) + 1;
      trimmedContent = `🎲 rolled a **${rollResult}** (1-100)`;
    } else if (trimmedContent === '/flip') {
      const coinResult = Math.random() < 0.5 ? 'Heads' : 'Tails';
      trimmedContent = `🪙 flipped a coin and got: **${coinResult}**!`;
    }

    const messageObj = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      clientTempId: clientTempId || null,
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

    // 1. Maintain in-memory cache synchronously (0ms lookup)
    saveMessageToMemory(messageObj);

    // 2. Broadcast immediately with zero latency to all clients in the room!
    io.to(roomId).emit('message:receive', messageObj);

    // 3. If this is a direct message, notify the recipient outside their active view
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

    // 4. Asynchronously persist to Firestore in the background (non-blocking)
    saveMessageToFirestore(messageObj).catch(err => {
      handleFirestoreError(err, `Async Firestore save message ${messageObj.id}`);
    });
  });

  // ------------------------------------------
  // EVENT: message:react (Emoji Reactions)
  // ------------------------------------------
  socket.on('message:react', async ({ roomId, messageId, emoji }) => {
    if (!roomId || !messageId || !emoji) return;

    // Rate limit reaction toggles: max 25 per 3 seconds
    if (isRateLimited(`react_${socket.id}`, 25, 3000)) return;

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
  // EVENT: message:read (Read Receipts tied to individual messages)
  // ------------------------------------------
  socket.on('message:read', async (data) => {
    const { roomId, messageId, messageIds } = data || {};
    if (!roomId) return;
    const targetIds = Array.isArray(messageIds)
      ? messageIds
      : (messageId ? [messageId] : []);
    if (targetIds.length === 0) return;

    const seenUpdates = await markMessagesAsSeen(roomId, targetIds, user);
    if (seenUpdates.length > 0) {
      // 1. Broadcast seen_update to room
      io.to(roomId).emit('message:seen_update', {
        roomId,
        seenUpdates
      });

      // 2. Broadcast individual message:read events to sender and room
      seenUpdates.forEach(update => {
        const payload = {
          roomId,
          messageId: update.messageId,
          seenBy: update.seenBy,
          readBy: update.readBy
        };

        // Broadcast to chat room
        io.to(roomId).emit('message:read', payload);

        // Direct emission to the message sender's personal room
        if (update.senderUid && update.senderUid !== user.uid) {
          io.to(`user_${update.senderUid}`).emit('message:read', payload);
        }
      });
    }
  });

  // ------------------------------------------
  // EVENT: profile:update (Real-time Profile Editing)
  // ------------------------------------------
  socket.on('profile:update', async (data) => {
    try {
      const { name, picture } = data || {};
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 80) {
        socket.emit('profile:update_error', { message: 'Display name must be between 2 and 80 characters' });
        return;
      }

      const cleanedPicture = (typeof picture === 'string' && picture.trim().length > 0)
        ? picture.trim()
        : null;

      // Update socket user state
      user.name = trimmedName;
      user.picture = cleanedPicture;

      const updatedProfile = await saveUserProfile(uid, {
        name: trimmedName,
        picture: cleanedPicture,
        email: user.email
      });

      // Notify caller of success
      socket.emit('profile:update_success', {
        uid,
        name: trimmedName,
        picture: cleanedPicture
      });

      // Broadcast update to ALL connected clients in real-time
      io.emit('user:profile_updated', {
        uid,
        name: trimmedName,
        picture: cleanedPicture,
        updatedAt: Date.now()
      });

      // Broadcast updated presence list
      io.emit('users:presence', getOnlineUsersList());
    } catch (err) {
      console.error('Socket profile update error:', err);
      socket.emit('profile:update_error', { message: err.message || 'Failed to update profile' });
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
    // Clean up rate limits for disconnected socket
    socketRateLimits.delete(socket.id);
    socketRateLimits.delete(`react_${socket.id}`);

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
  res.sendFile(path.join(staticDir, 'index.html'));
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 CampusConnect Chat Server is running on port ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🔥 Firebase Admin Ready: ${isFirebaseAdminReady}`);
  console.log(`====================================================`);
});

// Production-grade process lifecycle and error handling
function handleGracefulShutdown(signal) {
  console.log(`🛑 [Process] Received ${signal}. Draining connections and shutting down...`);
  server.close(() => {
    console.log('✅ [Process] HTTP and WebSocket connections closed cleanly.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('⚠️ [Process] Forcefully terminating after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('❌ [Server Uncaught Exception]:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Server Unhandled Rejection]:', reason);
});
