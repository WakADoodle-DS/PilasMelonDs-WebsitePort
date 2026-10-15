import { firebaseConfig, isChatConfigured } from "./chat-config.js";

const FIREBASE_VERSION = "13.0.0";
const FIREBASE_BASE = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";
const ROOM_COLLECTION = "gavindsChatRooms";
const MAX_MEMBERS = 12;
const MAX_MESSAGE_LENGTH = 400;
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MESSAGE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 8;

const $ = (id) => document.getElementById(id);

const dock = $("chatDock");
const launchBtn = $("chatLaunchBtn");
const chatWindow = $("chatWindow");
const minimizeBtn = $("chatMinimizeBtn");
const connectionState = $("chatConnectionState");
const setupNotice = $("chatSetupNotice");
const lobby = $("chatLobby");
const usernameInput = $("chatUsernameInput");
const createModeBtn = $("chatCreateModeBtn");
const joinModeBtn = $("chatJoinModeBtn");
const createForm = $("chatCreateForm");
const roomNameInput = $("chatRoomNameInput");
const joinForm = $("chatJoinForm");
const roomCodeInput = $("chatRoomCodeInput");
const lobbyError = $("chatLobbyError");
const roomView = $("chatRoomView");
const activeRoomName = $("chatActiveRoomName");
const activeRoomCode = $("chatActiveRoomCode");
const copyCodeBtn = $("chatCopyCodeBtn");
const messagesList = $("chatMessages");
const sendForm = $("chatSendForm");
const messageInput = $("chatMessageInput");
const memberCount = $("chatMemberCount");
const leaveRoomBtn = $("chatLeaveRoomBtn");
const closeRoomBtn = $("chatCloseRoomBtn");
const roomError = $("chatRoomError");

let auth = null;
let db = null;
let currentUser = null;
let activeRoom = null;
let stopRoomListener = null;
let stopMessagesListener = null;
let lastMessageSentAt = 0;
let backendReady = false;

function setChatStatus(message, connected = false) {
  connectionState.textContent = message;
  dock.dataset.connected = connected ? "true" : "false";
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function toggleChat(open) {
  chatWindow.hidden = !open;
  launchBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open && !activeRoom) {
    window.setTimeout(() => usernameInput.focus(), 0);
  }
}

function showLobbyMode(mode) {
  createForm.hidden = mode !== "create";
  joinForm.hidden = mode !== "join";
  showError(lobbyError, "");
}

function validateUsername() {
  const name = usernameInput.value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter a temporary username first.");
  if (name.length > 20) throw new Error("Keep your username to 20 characters or fewer.");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("That username contains unsupported characters.");
  return name;
}

function friendlyError(error, context) {
  console.error("[GavinDS Chat]", context, error);
  if (!backendReady) return "Live chat is not connected yet. The site owner needs to finish the one-time Firebase setup.";
  const code = error && error.code ? String(error.code) : "";
  if (code.includes("permission-denied")) return "The chat database rejected that action. Check the Firebase setup and security rules.";
  if (code.includes("unavailable") || code.includes("network")) return "Chat cannot reach the service right now. Check your connection and try again.";
  if (code.includes("unauthenticated")) return "Your temporary chat session could not be verified. Refresh the page and try again.";
  return error && error.message ? String(error.message) : "Something went wrong. Please try again.";
}

function makeRoomCode() {
  const randomBytes = new Uint8Array(ROOM_CODE_LENGTH);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i++) randomBytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(randomBytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

function roomRefFor(code) {
  return window.__gavinChatFirestore.doc(db, ROOM_COLLECTION, code);
}

function renderMessages(docs) {
  const list = messagesList;
  const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 70;
  list.replaceChildren();

  if (!docs.length) {
    const empty = document.createElement("li");
    empty.className = "chat-empty-message";
    empty.textContent = "Room created! Say hi to start the conversation.";
    list.append(empty);
    return;
  }

  // Snapshot query is newest-first, but chat history is displayed oldest-first.
  docs.slice().reverse().forEach((entry) => {
    const data = entry.data();
    const item = document.createElement("li");
    item.className = "chat-message" + (data.userId === (currentUser && currentUser.uid) ? " chat-message-own" : "");

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";
    const name = document.createElement("strong");
    name.textContent = String(data.username || "Guest");
    const time = document.createElement("time");
    const date = data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt.toDate() : null;
    time.textContent = date ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now";
    if (date) time.dateTime = date.toISOString();
    meta.append(name, time);

    const text = document.createElement("p");
    text.className = "chat-message-text";
    // Use textContent so chat text is always shown as text, never interpreted as HTML.
    text.textContent = String(data.text || "");

    item.append(meta, text);
    list.append(item);
  });

  if (wasNearBottom) list.scrollTop = list.scrollHeight;
}

function stopRoomListeners() {
  if (typeof stopRoomListener === "function") stopRoomListener();
  if (typeof stopMessagesListener === "function") stopMessagesListener();
  stopRoomListener = null;
  stopMessagesListener = null;
}

function returnToLobby(statusMessage) {
  stopRoomListeners();
  activeRoom = null;
  roomView.hidden = true;
  lobby.hidden = false;
  messagesList.replaceChildren();
  showError(roomError, "");
  showLobbyMode("");
  closeRoomBtn.hidden = true;
  leaveRoomBtn.hidden = false;
  setChatStatus(statusMessage || (backendReady ? "Connected · invite-code rooms" : "Chat setup needed"), backendReady);
}

function activateRoom(code, roomData, username) {
  stopRoomListeners();
  activeRoom = {
    code,
    username,
    ownerUid: roomData.ownerUid,
    title: roomData.title,
    memberIds: roomData.memberIds || [],
    memberNames: roomData.memberNames || {}
  };

  lobby.hidden = true;
  roomView.hidden = false;
  activeRoomName.textContent = activeRoom.title;
  activeRoomCode.textContent = code;
  messagesList.replaceChildren();
  showError(roomError, "");
  closeRoomBtn.hidden = activeRoom.ownerUid !== currentUser.uid;
  setChatStatus("Connected · invite-code room", true);

  const dbApi = window.__gavinChatFirestore;
  const ref = roomRefFor(code);
  stopRoomListener = dbApi.onSnapshot(ref, (snapshot) => {
    if (!snapshot.exists()) {
      returnToLobby("This room was closed or expired.");
      return;
    }
    const data = snapshot.data();
    if (!data || data.status !== "open" || !data.expiresAt || data.expiresAt.toMillis() <= Date.now()) {
      returnToLobby("This room has expired.");
      return;
    }
    if (!data.memberIds || !data.memberIds.includes(currentUser.uid)) {
      returnToLobby("You are no longer in this room.");
      return;
    }
    activeRoom.ownerUid = data.ownerUid;
    activeRoom.title = data.title;
    activeRoom.memberIds = data.memberIds;
    activeRoom.memberNames = data.memberNames || {};
    activeRoomName.textContent = data.title;
    memberCount.textContent = data.memberIds.length + " / " + MAX_MEMBERS + " members";
    closeRoomBtn.hidden = data.ownerUid !== currentUser.uid;
  }, (error) => {
    showError(roomError, friendlyError(error, "room listener"));
  });

  const messagesQuery = dbApi.query(
    dbApi.collection(ref, "messages"),
    dbApi.orderBy("createdAt", "desc"),
    dbApi.limit(50)
  );
  stopMessagesListener = dbApi.onSnapshot(messagesQuery, (snapshot) => {
    renderMessages(snapshot.docs);
  }, (error) => {
    showError(roomError, friendlyError(error, "message listener"));
  });
}

async function ensureConnected() {
  if (!isChatConfigured()) {
    throw new Error("Live chat is not configured. See CHAT_SETUP.md.");
  }
  if (!backendReady || !db || !currentUser) {
    throw new Error("Chat is still connecting. Try again in a moment.");
  }
}

async function createRoom(event) {
  event.preventDefault();
  showError(lobbyError, "");
  try {
    await ensureConnected();
    const username = validateUsername();
    const title = roomNameInput.value.trim().replace(/\s+/g, " ");
    if (title.length < 2 || title.length > 32) throw new Error("Room names must be 2–32 characters long.");
    if (/[\u0000-\u001f\u007f]/.test(title)) throw new Error("That room name contains unsupported characters.");

    const dbApi = window.__gavinChatFirestore;
    let createdCode = "";
    let created = false;

    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const code = makeRoomCode();
      const ref = roomRefFor(code);
      const didCreate = await dbApi.runTransaction(db, async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists()) return false;
        transaction.set(ref, {
          title,
          ownerUid: currentUser.uid,
          memberIds: [currentUser.uid],
          memberNames: { [currentUser.uid]: username },
          status: "open",
          createdAt: dbApi.serverTimestamp(),
          expiresAt: dbApi.Timestamp.fromMillis(Date.now() + ROOM_LIFETIME_MS)
        });
        return true;
      });
      if (didCreate) {
        created = true;
        createdCode = code;
      }
    }

    if (!created) throw new Error("Couldn't generate a room code. Please try again.");
    const snapshot = await dbApi.getDoc(roomRefFor(createdCode));
    if (!snapshot.exists()) throw new Error("Room created but couldn't be opened. Please try again.");
    activateRoom(createdCode, snapshot.data(), username);
  } catch (error) {
    showError(lobbyError, friendlyError(error, "create room"));
  }
}

async function joinRoom(event) {
  event.preventDefault();
  showError(lobbyError, "");
  try {
    await ensureConnected();
    const username = validateUsername();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!new RegExp("^[A-HJ-NP-Z2-9]{" + ROOM_CODE_LENGTH + "}$").test(code)) {
      throw new Error("Enter the eight-character room code exactly as shown by the host.");
    }

    const dbApi = window.__gavinChatFirestore;
    const ref = roomRefFor(code);
    const roomData = await dbApi.runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error("No room was found for that code.");
      const data = snapshot.data();
      if (data.status !== "open" || !data.expiresAt || data.expiresAt.toMillis() <= Date.now()) {
        throw new Error("That room has expired or is closed.");
      }

      const members = Array.isArray(data.memberIds) ? data.memberIds.slice() : [];
      const names = { ...(data.memberNames || {}) };
      if (!members.includes(currentUser.uid)) {
        if (members.length >= MAX_MEMBERS) throw new Error("That room is full (12 people maximum).");
        members.push(currentUser.uid);
      }
      names[currentUser.uid] = username;
      transaction.update(ref, { memberIds: members, memberNames: names });
      return { ...data, memberIds: members, memberNames: names };
    });

    activateRoom(code, roomData, username);
  } catch (error) {
    showError(lobbyError, friendlyError(error, "join room"));
  }
}

async function sendMessage(event) {
  event.preventDefault();
  showError(roomError, "");
  if (!activeRoom) return;

  const text = messageInput.value.trim();
  if (!text) return;
  if (text.length > MAX_MESSAGE_LENGTH) {
    showError(roomError, "Messages are limited to " + MAX_MESSAGE_LENGTH + " characters.");
    return;
  }
  const now = Date.now();
  if (now - lastMessageSentAt < 900) {
    showError(roomError, "Give it a moment before sending another message.");
    return;
  }

  try {
    await ensureConnected();
    const room = activeRoom;
    if (!room) return;
    const dbApi = window.__gavinChatFirestore;
    const ref = roomRefFor(room.code);
    lastMessageSentAt = now;
    await dbApi.addDoc(dbApi.collection(ref, "messages"), {
      userId: currentUser.uid,
      username: room.username,
      text,
      createdAt: dbApi.serverTimestamp(),
      expiresAt: dbApi.Timestamp.fromMillis(Date.now() + MESSAGE_LIFETIME_MS)
    });
    if (activeRoom && activeRoom.code === room.code) {
      messageInput.value = "";
      messageInput.focus();
    }
  } catch (error) {
    showError(roomError, friendlyError(error, "send message"));
  }
}

async function leaveRoom() {
  if (!activeRoom) return;
  const room = activeRoom;
  stopRoomListeners();
  try {
    if (backendReady && currentUser) {
      const dbApi = window.__gavinChatFirestore;
      const ref = roomRefFor(room.code);
      await dbApi.runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (!data.memberIds || !data.memberIds.includes(currentUser.uid)) return;
        const members = data.memberIds.filter((id) => id !== currentUser.uid);
        const names = { ...(data.memberNames || {}) };
        delete names[currentUser.uid];
        transaction.update(ref, { memberIds: members, memberNames: names });
      });
    }
  } catch (error) {
    console.warn("[GavinDS Chat] Could not remove temporary room membership:", error);
  } finally {
    activeRoom = null;
    returnToLobby("You left the room.");
  }
}

async function closeRoom() {
  if (!activeRoom || !currentUser || activeRoom.ownerUid !== currentUser.uid) return;
  const room = activeRoom;
  closeRoomBtn.disabled = true;
  showError(roomError, "");
  try {
    const dbApi = window.__gavinChatFirestore;
    await dbApi.deleteDoc(roomRefFor(room.code));
    activeRoom = null;
    returnToLobby("Room closed.");
  } catch (error) {
    showError(roomError, friendlyError(error, "close room"));
  } finally {
    closeRoomBtn.disabled = false;
  }
}

async function copyRoomCode() {
  if (!activeRoom) return;
  try {
    await navigator.clipboard.writeText(activeRoom.code);
    copyCodeBtn.textContent = "Copied!";
    window.setTimeout(() => { copyCodeBtn.textContent = "Copy code"; }, 1400);
  } catch {
    showError(roomError, "Your browser blocked clipboard access. Select and copy the room code manually.");
  }
}

function bindChatUi() {
  launchBtn.addEventListener("click", () => toggleChat(chatWindow.hidden));
  minimizeBtn.addEventListener("click", () => toggleChat(false));
  createModeBtn.addEventListener("click", () => showLobbyMode("create"));
  joinModeBtn.addEventListener("click", () => showLobbyMode("join"));
  createForm.addEventListener("submit", createRoom);
  joinForm.addEventListener("submit", joinRoom);
  sendForm.addEventListener("submit", sendMessage);
  leaveRoomBtn.addEventListener("click", leaveRoom);
  closeRoomBtn.addEventListener("click", closeRoom);
  copyCodeBtn.addEventListener("click", copyRoomCode);
  roomCodeInput.addEventListener("input", () => {
    roomCodeInput.value = roomCodeInput.value.replace(/[^a-zA-Z2-9]/g, "").toUpperCase().slice(0, ROOM_CODE_LENGTH);
  });
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendForm.requestSubmit();
    }
  });
}

async function initializeChat() {
  bindChatUi();

  if (!isChatConfigured()) {
    setupNotice.hidden = false;
    setChatStatus("Setup needed · see CHAT_SETUP.md", false);
    return;
  }

  setChatStatus("Connecting…", false);
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import(FIREBASE_BASE + "firebase-app.js"),
      import(FIREBASE_BASE + "firebase-auth.js"),
      import(FIREBASE_BASE + "firebase-firestore.js")
    ]);

    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
    auth = authSdk.getAuth(app);
    db = firestoreSdk.getFirestore(app);
    window.__gavinChatFirestore = firestoreSdk;
    // Reuse the browser's existing anonymous session so a refresh doesn't
    // accidentally switch the user's Firebase UID while they are in a room.
    await auth.authStateReady();
    if (!auth.currentUser) await authSdk.signInAnonymously(auth);
    currentUser = auth.currentUser;
    backendReady = Boolean(currentUser);
    if (!backendReady) throw new Error("Anonymous sign-in did not return a temporary session.");
    setupNotice.hidden = true;
    setChatStatus("Connected · invite-code rooms", true);
  } catch (error) {
    backendReady = false;
    setupNotice.hidden = false;
    setChatStatus("Can't connect · check setup", false);
    showError(lobbyError, friendlyError(error, "initialize chat"));
    const setupText = setupNotice.querySelector("span");
    if (setupText) setupText.textContent = "Check CHAT_SETUP.md, especially anonymous sign-in and Firestore rules. Chat is separate from the emulator, so your games should still work.";
  }
}

initializeChat();
