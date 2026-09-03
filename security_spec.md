# Firestore Security Specification & Verification

## 1. Data Invariants

- **Authentication & Identity**: Every write to user data or messages must originate from an authenticated user (`request.auth != null`). Users may not spoof their sender UID.
- **Messages Collection (`/messages/{messageId}`)**:
  - Valid document ID format: alphanumeric with dashes/underscores (`^[a-zA-Z0-9_\\-]+$`) up to 128 characters.
  - Messages must specify a valid `roomId` (channel identifier or DM identifier).
  - The `sender.uid` must match the authenticated user's UID (`request.auth.uid`).
  - Text content must be a string up to 2000 characters.
  - Image attachment, if present, must be a string (data URL) with size constraint.
  - Timestamps must not be arbitrarily futuristic.
  - Reactions: authenticated users can only toggle their own UID inside a reaction emoji bucket.
  - Read receipts (`seenBy`): users can only append their own seen receipt (`entry.uid == request.auth.uid`).
- **Users Collection (`/users/{userId}`)**:
  - Document ID `{userId}` must match `request.auth.uid` for writes (ownership constraint).
  - Status must be one of `['online', 'away', 'studying']`.
- **Channels Collection (`/channels/{channelId}`)**:
  - Predefined school channels are read-only for students; modifications restricted.

---

## 2. The "Dirty Dozen" Vulnerability Payloads

1. **Payload 1 (Ghost UID Spoofing)**: Attacker attempts to send message with `sender.uid: 'victim_123'` while logged in as `attacker_456`.
2. **Payload 2 (Oversized Message Content)**: Attacker attempts to send a 50,000 character string in `content` (Denial of Wallet).
3. **Payload 3 (Unauthenticated Read/Write)**: Anonymous client attempts to read private direct messages or post without auth.
4. **Payload 4 (Malformed Document ID)**: Attacker attempts to inject special characters or 2KB path traversal string as `{messageId}`.
5. **Payload 5 (Reaction Hijacking)**: Attacker attempts to add/remove another student's UID from a reaction array.
6. **Payload 6 (Read Receipt Forgery)**: Attacker attempts to forge a read receipt claiming another user viewed a message.
7. **Payload 7 (Profile Tampering)**: Attacker attempts to modify another student's `/users/{userId}` document.
8. **Payload 8 (Channel Defacement)**: Regular student attempts to delete or rename `#general` or `#homework-help`.
9. **Payload 9 (Arbitrary Extra Fields Injection)**: Attacker sends shadow fields like `isAdmin: true` or `role: 'principal'` inside message object.
10. **Payload 10 (Invalid Room ID)**: Attacker submits messages without a valid target room or channel.
11. **Payload 11 (Oversized Reaction Payload)**: Attacker sends an array of 5,000 reaction entries to exceed document budget.
12. **Payload 12 (Direct Message Sniffing)**: User attempts to list/read DM messages belonging to two other unrelated students.

---

## 3. Test Runner Verification

All 12 payloads must evaluate to `PERMISSION_DENIED` under the rules defined in `firestore.rules`.
