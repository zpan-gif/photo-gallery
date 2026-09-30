import crypto from "crypto";
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { google } from "googleapis";
import multer from "multer";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Session Middleware to parse/assign session cookie
app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/session_id=([^;]+)/);
  let sessionId = match ? match[1] : null;

  if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    res.cookie("session_id", sessionId, { httpOnly: true, path: "/", maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: "lax" });
  }
  (req as any).sessionId = sessionId;
  next();
});

// Initialize Firebase Admin SDK
const FIREBASE_CREDENTIALS_PATH = path.join(process.cwd(), "firebase-service-account.json");
let db: Firestore | null = null;

try {
  let serviceAccount: any = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else if (fs.existsSync(FIREBASE_CREDENTIALS_PATH)) {
    serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_CREDENTIALS_PATH, "utf-8"));
  }

  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount)
    });
    db = getFirestore();
    console.log("Firebase Admin SDK initialized successfully.");
  } else {
    console.warn("Neither FIREBASE_SERVICE_ACCOUNT env var nor firebase-service-account.json found. Firebase Firestore is offline.");
  }
} catch (e) {
  console.error("Failed to initialize Firebase Admin SDK:", e);
}

interface CoHostInfo {
  email: string;
  permissionId?: string;
  addedAt: number;
}

interface SavedCredentials {
  refreshToken: string;
  folderId?: string;
  folderName?: string;
  ownerEmail?: string;
  ownerSessionId?: string;
  allowGuestNames?: boolean;
  hideGuestGallery?: boolean;
  coHosts?: CoHostInfo[];
  coHostKey?: string;
}

// Helper to read header values whether headers is a standard Headers object or plain object
function getResponseHeader(headers: any, name: string): string | null {
  if (!headers) return null;
  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase());
  }
  return headers[name] || headers[name.toLowerCase()] || null;
}

// Fast In-Memory Credentials Cache to eliminate Firestore roundtrip latency during batch uploads
const sessionCredentialsCache = new Map<string, { data: SavedCredentials; expires: number }>();
const folderCredentialsCache = new Map<string, { data: SavedCredentials; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Read saved credentials containing OAuth refresh token and created folder ID for a specific session
async function getSavedCredentials(sessionId: string): Promise<SavedCredentials | null> {
  if (!sessionId) return null;

  const cached = sessionCredentialsCache.get(sessionId);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  if (db) {
    try {
      const doc = await db.collection("sessions").doc(sessionId).get();
      if (doc.exists) {
        const data = doc.data() as SavedCredentials;
        sessionCredentialsCache.set(sessionId, { data, expires: Date.now() + CACHE_TTL_MS });
        if (data.folderId) {
          folderCredentialsCache.set(data.folderId, { data, expires: Date.now() + CACHE_TTL_MS });
        }
        return data;
      }
    } catch (e) {
      console.error("Error reading saved credentials from Firestore:", e);
    }
  }

  // Fallback to local drive-credentials.json ONLY if this session is the one that authenticated
  const fileCreds = getFileFallbackCredentials();
  if (fileCreds && fileCreds.ownerSessionId && fileCreds.ownerSessionId === sessionId) {
    sessionCredentialsCache.set(sessionId, { data: fileCreds, expires: Date.now() + CACHE_TTL_MS });
    return fileCreds;
  }

  // Never return another user's session credentials to an unauthenticated visitor!
  return null;
}

// Fallback to local drive-credentials.json if Firestore does not contain credentials
function getFileFallbackCredentials(): SavedCredentials | null {
  const filePath = path.join(process.cwd(), "drive-credentials.json");
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (data && data.refreshToken) return data;
    } catch (e) {}
  }
  return null;
}

// Save credentials safely to Firestore and local fallback
async function saveCredentials(sessionId: string, creds: SavedCredentials) {
  const credsWithSession: SavedCredentials = { ...creds, ownerSessionId: sessionId };
  sessionCredentialsCache.set(sessionId, { data: credsWithSession, expires: Date.now() + CACHE_TTL_MS });
  if (creds.folderId) {
    folderCredentialsCache.set(creds.folderId, { data: credsWithSession, expires: Date.now() + CACHE_TTL_MS });
  }

  try {
    const filePath = path.join(process.cwd(), "drive-credentials.json");
    fs.writeFileSync(filePath, JSON.stringify(credsWithSession, null, 2));
  } catch (e) {
    console.error("Error writing fallback credentials:", e);
  }

  if (!db) {
    return;
  }
  try {
    await db.collection("sessions").doc(sessionId).set(credsWithSession, { merge: true });
  } catch (e) {
    console.error("Error writing credentials to Firestore:", e);
  }
}

// Update credentials by folderId across memory cache, Firestore, and fallback
async function updateFolderCredentials(folderId: string, updates: Partial<SavedCredentials>) {
  const cached = folderCredentialsCache.get(folderId);
  if (cached) {
    cached.data = { ...cached.data, ...updates };
  }
  if (db) {
    try {
      const snapshot = await db.collection("sessions").where("folderId", "==", folderId).limit(1).get();
      if (!snapshot.empty) {
        const docId = snapshot.docs[0].id;
        await db.collection("sessions").doc(docId).set(updates, { merge: true });
        const sessionCached = sessionCredentialsCache.get(docId);
        if (sessionCached) {
          sessionCached.data = { ...sessionCached.data, ...updates };
        }
      }
    } catch (e) {
      console.error("Error updating folder credentials in Firestore:", e);
    }
  }
  const fileCreds = getFileFallbackCredentials();
  if (fileCreds && (!fileCreds.folderId || fileCreds.folderId === folderId)) {
    try {
      const filePath = path.join(process.cwd(), "drive-credentials.json");
      fs.writeFileSync(filePath, JSON.stringify({ ...fileCreds, ...updates }, null, 2));
    } catch (e) {}
  }
}

// Delete credentials (disconnect / sign out)
async function deleteCredentials(sessionId: string) {
  const cached = sessionCredentialsCache.get(sessionId);
  if (cached?.data?.folderId) {
    folderCredentialsCache.delete(cached.data.folderId);
  }
  sessionCredentialsCache.delete(sessionId);

  // Clear fallback credentials file so disconnected state takes effect
  const filePath = path.join(process.cwd(), "drive-credentials.json");
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error("Error unlinking local fallback credentials:", e);
    }
  }

  if (!db) {
    return;
  }
  try {
    await db.collection("sessions").doc(sessionId).delete();
  } catch (e) {
    console.error("Error deleting credentials in Firestore:", e);
  }
}

// Look up credentials by target folder ID to support guest access
async function getSavedCredentialsForFolder(folderId: string): Promise<SavedCredentials | null> {
  const cached = folderCredentialsCache.get(folderId);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  if (!db) {
    console.error("Firebase Firestore is not initialized.");
    const fileCreds = getFileFallbackCredentials();
    if (fileCreds && (!fileCreds.folderId || fileCreds.folderId === folderId)) {
      return fileCreds;
    }
    return null;
  }
  try {
    const snapshot = await db.collection("sessions").where("folderId", "==", folderId).limit(1).get();
    if (!snapshot.empty) {
      const data = snapshot.docs[0].data() as SavedCredentials;
      folderCredentialsCache.set(folderId, { data, expires: Date.now() + CACHE_TTL_MS });
      return data;
    }
  } catch (e) {
    console.error("Error querying credentials for folder in Firestore:", e);
  }
  const fileCreds = getFileFallbackCredentials();
  if (fileCreds && (!fileCreds.folderId || fileCreds.folderId === folderId)) {
    return fileCreds;
  }
  return null;
}

// Instantiate OAuth Client lazily to prevent boot crashes if variables are missing
function getOAuthClient(customRedirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  let redirectUri = customRedirectUri || process.env.GOOGLE_REDIRECT_URI;
  if (!redirectUri) {
    let baseUrl = process.env.APP_URL || "http://localhost:3000";
    if (baseUrl.includes("ais-dev-")) {
      baseUrl = baseUrl.replace("ais-dev-", "ais-pre-");
    }
    redirectUri = `${baseUrl}/api/oauth/callback`;
  }

  if (redirectUri && redirectUri.includes("ais-dev-")) {
    redirectUri = redirectUri.replace("ais-dev-", "ais-pre-");
  }

  if (!clientId || !clientSecret) {
    throw new Error("Google Client ID or Google Client Secret is not configured in your Environment Secrets.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Get authorized Drive Service Instance
function getAuthorizedDriveClient(creds: SavedCredentials) {
  if (!creds || !creds.refreshToken) {
    throw new Error("Google Drive is not connected. Authenticate as the Owner first.");
  }
  
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: creds.refreshToken
  });
  
  return google.drive({ version: "v3", auth: oauth2Client });
}

// Configure multer to save uploads to the OS temp directory with 100MB limit
const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Cache recent uploads on disk for 5 minutes so immediate playback by guests/uploaders starts in 0.01s
const recentUploadsCache = new Map<string, { path: string; mimeType: string; expires: number }>();
const fileMimeCache = new Map<string, { mimeType: string; expires: number }>();

// Periodic cleanup of cached temp files
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of recentUploadsCache.entries()) {
    if (item.expires < now) {
      try {
        if (fs.existsSync(item.path)) fs.unlinkSync(item.path);
      } catch (e) {}
      recentUploadsCache.delete(id);
    }
  }
  for (const [id, item] of fileMimeCache.entries()) {
    if (item.expires < now) {
      fileMimeCache.delete(id);
    }
  }
}, 60 * 1000);

// Lightweight health check endpoint for keep-alive monitoring
app.get("/ping", (req, res) => {
  res.status(200).send("OK");
});

// 1. App Connection & Auth Status Endpoint
app.get("/api/status", async (req, res) => {
  const sessionId = (req as any).sessionId;
  const creds = await getSavedCredentials(sessionId);
  const rawClientId = process.env.GOOGLE_CLIENT_ID || "";
  const rawClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  
  const clientIdConfigured = !!rawClientId;
  const clientSecretConfigured = !!rawClientSecret;
  const appUrlConfigured = !!process.env.APP_URL;

  // Compute the expected redirect URI
  let computedRedirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!computedRedirectUri) {
    let baseUrl = process.env.APP_URL || "http://localhost:3000";
    if (baseUrl.includes("ais-dev-")) {
      baseUrl = baseUrl.replace("ais-dev-", "ais-pre-");
    }
    computedRedirectUri = `${baseUrl}/api/oauth/callback`;
  }

  if (computedRedirectUri && computedRedirectUri.includes("ais-dev-")) {
    computedRedirectUri = computedRedirectUri.replace("ais-dev-", "ais-pre-");
  }

  // Diagnostics check
  const clientIdTrimmed = rawClientId.trim();
  const clientSecretTrimmed = rawClientSecret.trim();
  const hasWhitespace = (rawClientId.length !== clientIdTrimmed.length) || (rawClientSecret.length !== clientSecretTrimmed.length);
  const isValidSuffix = clientIdTrimmed.endsWith("googleusercontent.com");
  
  let ownerEmail = creds?.ownerEmail || null;
  if (creds && creds.refreshToken && !ownerEmail) {
    try {
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials({
        refresh_token: creds.refreshToken
      });
      const tokenInfo = await oauth2Client.getAccessToken();
      if (tokenInfo && tokenInfo.token) {
        const emailRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${tokenInfo.token}` }
        });
        if (emailRes.ok) {
          const emailData = await emailRes.json();
          if (emailData && emailData.email) {
            ownerEmail = emailData.email;
            creds.ownerEmail = ownerEmail;
            await saveCredentials(sessionId, creds);
          }
        }
      }
    } catch (e) {
      console.error("Failed to dynamically resolve owner email:", e);
    }
  }

  let storageQuota = null;
  if (creds && creds.refreshToken) {
    try {
      const drive = getAuthorizedDriveClient(creds);
      const aboutRes = await drive.about.get({
        fields: "storageQuota",
      });
      if (aboutRes.data && aboutRes.data.storageQuota) {
        const quota = aboutRes.data.storageQuota;
        const limitStr = quota.limit ? String(quota.limit) : "0";
        const usageStr = quota.usage ? String(quota.usage) : "0";
        
        const limitNum = parseInt(limitStr, 10);
        const usageNum = parseInt(usageStr, 10);
        
        let percentageUsed = 0;
        let isNearingLimit = false;
        
        if (limitNum > 0) {
          percentageUsed = (usageNum / limitNum) * 100;
          // Drive standard limit is usually 15 GB, trigger warning if used exceeds 85% or remaining is less than 1.5 GB
          const remainingNum = limitNum - usageNum;
          if (percentageUsed >= 85 || remainingNum < 1500000000) {
            isNearingLimit = true;
          }
        }
        
        storageQuota = {
          limit: limitStr,
          usage: usageStr,
          percentageUsed: Math.round(percentageUsed * 10) / 10,
          isNearingLimit,
        };
      }
    } catch (e) {
      console.error("Failed to fetch Google Drive storage quota:", e);
    }
  }

  const queryFolderId = req.query.folderId as string;
  const targetFolderId = queryFolderId || creds?.folderId;
  const reqCoHostKey = (req.query.key || req.query.cohostKey || req.headers["x-cohost-key"]) as string | undefined;
  const roleParam = req.query.role as string | undefined;

  let canEdit = false;
  let userRole = "guest";
  let isCoHost = false;

  let folderCreds = targetFolderId ? await getSavedCredentialsForFolder(targetFolderId) : creds;
  if (!folderCreds && creds) {
    folderCreds = creds;
  }

  // Ensure target folder has a stable coHostKey generated and saved
  if (folderCreds && targetFolderId && !folderCreds.coHostKey) {
    folderCreds.coHostKey = crypto.randomBytes(16).toString("hex");
    await updateFolderCredentials(targetFolderId, { coHostKey: folderCreds.coHostKey });
  }

  // 1. Check direct coHostKey authorization (from Co-Host Direct Link)
  const isKeyAuthorized = Boolean(
    folderCreds?.coHostKey &&
    reqCoHostKey &&
    reqCoHostKey.trim() === folderCreds.coHostKey.trim()
  );

  if (isKeyAuthorized || (roleParam === "cohost" && isKeyAuthorized)) {
    canEdit = true;
    isCoHost = true;
    userRole = "cohost";
  }

  // 2. Check ownership & Google Drive session capabilities
  if (!canEdit && targetFolderId && creds && creds.refreshToken) {
    // Is caller the owner?
    const isOwnerAccount = Boolean(
      (folderCreds?.ownerEmail && creds.ownerEmail && folderCreds.ownerEmail.toLowerCase() === creds.ownerEmail.toLowerCase()) ||
      (!queryFolderId && creds.folderId === targetFolderId)
    );

    if (isOwnerAccount) {
      canEdit = true;
      userRole = "owner";
      isCoHost = false;
    } else {
      // Check if caller's email is in invited coHosts list
      const inCoHostsList = Boolean(
        creds.ownerEmail &&
        folderCreds?.coHosts?.some(c => c.email.toLowerCase() === creds.ownerEmail!.toLowerCase())
      );

      if (inCoHostsList) {
        canEdit = true;
        isCoHost = true;
        userRole = "editor";
      } else {
        // Check direct Google Drive capabilities
        try {
          const drive = getAuthorizedDriveClient(creds);
          const folderCheck = await drive.files.get({
            fileId: targetFolderId,
            fields: "capabilities(canEdit, canDelete, canAddChildren), owners",
          });
          const caps = folderCheck.data.capabilities;
          if (caps?.canEdit || caps?.canDelete || caps?.canAddChildren) {
            canEdit = true;
            isCoHost = true;
            userRole = "editor";
          }
        } catch (e) {
          // Folder not shared with user or insufficient permissions
        }
      }
    }
  }

  // If authorized as co-host or owner, determine connection state
  const isConnected = !!(creds && creds.refreshToken) || (isCoHost && !!(folderCreds && folderCreds.refreshToken));

  // If storageQuota wasn't fetched yet (e.g. caller doesn't have direct session) but folderCreds exists, fetch it
  if (!storageQuota && isCoHost && folderCreds && folderCreds.refreshToken) {
    try {
      const drive = getAuthorizedDriveClient(folderCreds);
      const aboutRes = await drive.about.get({ fields: "storageQuota" });
      if (aboutRes.data && aboutRes.data.storageQuota) {
        const quota = aboutRes.data.storageQuota;
        const limitStr = quota.limit ? String(quota.limit) : "0";
        const usageStr = quota.usage ? String(quota.usage) : "0";
        const limitNum = parseInt(limitStr, 10);
        const usageNum = parseInt(usageStr, 10);
        let percentageUsed = 0;
        let isNearingLimit = false;
        if (limitNum > 0) {
          percentageUsed = (usageNum / limitNum) * 100;
          const remainingNum = limitNum - usageNum;
          if (percentageUsed >= 85 || remainingNum < 1500000000) {
            isNearingLimit = true;
          }
        }
        storageQuota = {
          limit: limitStr,
          usage: usageStr,
          percentageUsed: Math.round(percentageUsed * 10) / 10,
          isNearingLimit,
        };
      }
    } catch (e) {
      console.error("Failed to fetch Google Drive storage quota for co-host:", e);
    }
  }

  res.json({
    connected: isConnected,
    folderId: targetFolderId || (creds ? creds.folderId : null),
    folderName: folderCreds ? (folderCreds.folderName || "App Uploads Gallery") : null,
    ownerEmail: folderCreds?.ownerEmail || ownerEmail || null,
    userEmail: creds?.ownerEmail || (isCoHost ? "Co-Host Moderator" : (ownerEmail || null)),
    canEdit,
    isHost: canEdit || userRole === "owner" || isCoHost,
    isCoHost,
    userRole,
    coHostKey: (canEdit || isCoHost || userRole === "owner") ? folderCreds?.coHostKey : undefined,
    coHosts: folderCreds?.coHosts || [],
    allowGuestNames: !!folderCreds?.allowGuestNames,
    hideGuestGallery: !!folderCreds?.hideGuestGallery,
    envConfigured: clientIdConfigured && clientSecretConfigured,
    storageQuota,
    missingEnv: {
      GOOGLE_CLIENT_ID: !clientIdConfigured,
      GOOGLE_CLIENT_SECRET: !clientSecretConfigured,
      APP_URL: !appUrlConfigured,
    },
    diagnostics: {
      redirectUri: computedRedirectUri,
      hasWhitespace,
      isValidSuffix,
      clientIdLength: clientIdTrimmed.length,
      clientSecretLength: clientSecretTrimmed.length,
      clientIdPreview: clientIdTrimmed ? `${clientIdTrimmed.substring(0, 10)}...${clientIdTrimmed.substring(Math.max(0, clientIdTrimmed.length - 15))}` : "None"
    }
  });
});

// 2. Generate Auth Url redirect
app.get("/api/auth/url", (req, res) => {
  try {
    const useFullScope = req.query.full === "true";
    const originParam = req.query.origin ? String(req.query.origin) : "";
    
    let dynamicBaseUrl = originParam || process.env.APP_URL || "http://localhost:3000";
    if (dynamicBaseUrl.includes("ais-dev-")) {
      dynamicBaseUrl = dynamicBaseUrl.replace("ais-dev-", "ais-pre-");
    }

    let computedRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${dynamicBaseUrl}/api/oauth/callback`;
    if (computedRedirectUri.includes("ais-dev-")) {
      computedRedirectUri = computedRedirectUri.replace("ais-dev-", "ais-pre-");
    }

    const oauth2Client = getOAuthClient(computedRedirectUri);
    
    const scopes = useFullScope
      ? [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/userinfo.email"
        ]
      : [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/userinfo.email"
        ];

    let finalState = originParam;
    if (finalState.includes("ais-dev-")) {
      finalState = finalState.replace("ais-dev-", "ais-pre-");
    }

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account", // Force Google Account Chooser so user can sign into different accounts
      scope: scopes,
      state: finalState
    });
    res.json({ url });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to generate Google auth URL." });
  }
});

// 3. OAuth Callback redirect handler
app.get("/api/oauth/callback", async (req, res) => {
  const { code, error, state } = req.query;
  const sessionId = (req as any).sessionId;

  let redirectOrigin = "";
  if (state && typeof state === "string") {
    let stateStr = state.trim();
    if (stateStr.includes("ais-dev-")) {
      stateStr = stateStr.replace("ais-dev-", "ais-pre-");
    }
    if (stateStr.startsWith("http://localhost") || /https:\/\/ais-(dev|pre)-[a-z0-9-]+\.[a-z0-9-.]+/i.test(stateStr)) {
      redirectOrigin = stateStr;
    }
  }

  if (redirectOrigin.includes("ais-dev-")) {
    redirectOrigin = redirectOrigin.replace("ais-dev-", "ais-pre-");
  }

  if (error) {
    const errorStr = String(error);
    const msgStr = String(req.query.msg || "");
    const destination = redirectOrigin
      ? `${redirectOrigin}/?error=${encodeURIComponent(errorStr)}&msg=${encodeURIComponent(msgStr)}`
      : `/?error=${encodeURIComponent(errorStr)}&msg=${encodeURIComponent(msgStr)}`;

    return res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(errorStr)}, msg: ${JSON.stringify(msgStr)} }, '*');
              window.close();
            } else {
              window.location.href = ${JSON.stringify(destination)};
            }
          </script>
          <p>Authentication failed: ${errorStr}. You may close this window.</p>
        </body>
      </html>
    `);
  }
  if (!code) {
    const destination = redirectOrigin
      ? `${redirectOrigin}/?error=missing_code`
      : `/?error=missing_code`;

    return res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'missing_code', msg: 'Could not retrieve verification code from Google.' }, '*');
              window.close();
            } else {
              window.location.href = ${JSON.stringify(destination)};
            }
          </script>
          <p>Authentication failed: missing_code. You may close this window.</p>
        </body>
      </html>
    `);
  }

  try {
    let dynamicBaseUrl = redirectOrigin || process.env.APP_URL || "http://localhost:3000";
    if (dynamicBaseUrl.includes("ais-dev-")) {
      dynamicBaseUrl = dynamicBaseUrl.replace("ais-dev-", "ais-pre-");
    }

    let computedRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${dynamicBaseUrl}/api/oauth/callback`;
    if (computedRedirectUri.includes("ais-dev-")) {
      computedRedirectUri = computedRedirectUri.replace("ais-dev-", "ais-pre-");
    }

    const oauth2Client = getOAuthClient(computedRedirectUri);
    const { tokens } = await oauth2Client.getToken(String(code));
    
    let refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      const currentCreds = await getSavedCredentials(sessionId);
      if (currentCreds && currentCreds.refreshToken) {
        refreshToken = currentCreds.refreshToken;
      } else {
        const msg = "Google did not return a refresh token. If you previously connected, please visit Google Account Security settings, remove access to this app, and try again, or connect via an Incognito window.";
        const destination = redirectOrigin
          ? `${redirectOrigin}/?error=no_refresh_token&msg=${encodeURIComponent(msg)}`
          : `/?error=no_refresh_token&msg=${encodeURIComponent(msg)}`;

        return res.send(`
          <html>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'no_refresh_token', msg: ${JSON.stringify(msg)} }, '*');
                  window.close();
                } else {
                  window.location.href = ${JSON.stringify(destination)};
                }
              </script>
              <p>Authentication failed: no_refresh_token. You may close this window.</p>
            </body>
          </html>
        `);
      }
    }

    // Save refresh token and keep previous folder attributes if they already exist
    const currentCreds = await getSavedCredentials(sessionId);
    
    let resolvedEmail = currentCreds?.ownerEmail || "";
    try {
      oauth2Client.setCredentials(tokens);
      const emailRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      if (emailRes.ok) {
        const emailData = await emailRes.json();
        if (emailData && emailData.email) {
          resolvedEmail = emailData.email;
        }
      }
    } catch (e) {
      console.error("Failed to query email during auth callback:", e);
    }

    await saveCredentials(sessionId, {
      refreshToken,
      ownerEmail: resolvedEmail || undefined,
      ...(currentCreds && currentCreds.folderId ? { folderId: currentCreds.folderId } : {}),
      ...(currentCreds && currentCreds.folderName ? { folderName: currentCreds.folderName } : {}),
    });

    const destination = redirectOrigin
      ? `${redirectOrigin}/?status=connected`
      : `/?status=connected`;

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = ${JSON.stringify(destination)};
            }
          </script>
          <p>Authentication successful! This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("OAuth Callback Error:", err);
    const msg = err.message || "Failed exchange processing.";
    const destination = redirectOrigin
      ? `${redirectOrigin}/?error=oauth_error&msg=${encodeURIComponent(msg)}`
      : `/?error=oauth_error&msg=${encodeURIComponent(msg)}`;

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: 'oauth_error', msg: ${JSON.stringify(msg)} }, '*');
              window.close();
            } else {
              window.location.href = ${JSON.stringify(destination)};
            }
          </script>
          <p>Authentication failed: ${msg}. You may close this window.</p>
        </body>
      </html>
    `);
  }
});

// 4. Logout / Disconnect Google Drive
app.post("/api/disconnect", async (req, res) => {
  const sessionId = (req as any).sessionId;
  await deleteCredentials(sessionId);
  res.clearCookie("session_id");
  res.json({ success: true, connected: false });
});

// 5. Gallery Photo Listing
app.get("/api/photos", async (req, res) => {
  const queryFolderId = req.query.folderId as string;
  const sessionId = (req as any).sessionId;
  const myUploadsRaw = req.query.myUploads as string;
  let myUploadIds: string[] = [];
  if (myUploadsRaw) {
    try {
      myUploadIds = JSON.parse(myUploadsRaw);
    } catch {
      myUploadIds = myUploadsRaw.split(",").filter(Boolean);
    }
  }

  try {
    let creds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    let ownerCreds = await getSavedCredentials(sessionId);
    if (!creds) {
      creds = ownerCreds;
    }
    if (!creds) {
      return res.json({ connected: false, photos: [] });
    }

    const folderId = queryFolderId || creds.folderId;
    if (!folderId) {
      return res.json({ connected: false, photos: [] });
    }

    const drive = getAuthorizedDriveClient(creds);
    
    let isOwner = false;
    let isCoHost = false;

    const reqCoHostKey = (req.query.key || req.query.cohostKey || req.headers["x-cohost-key"]) as string | undefined;
    if (creds.coHostKey && reqCoHostKey && reqCoHostKey.trim() === creds.coHostKey.trim()) {
      isCoHost = true;
    }

    if (ownerCreds && ownerCreds.refreshToken) {
      if (ownerCreds.ownerEmail && creds.ownerEmail && ownerCreds.ownerEmail.toLowerCase() === creds.ownerEmail.toLowerCase()) {
        isOwner = true;
      } else if (!queryFolderId && ownerCreds.folderId === folderId) {
        isOwner = true;
      }

      if (!isOwner && ownerCreds.ownerEmail && creds.coHosts) {
        isCoHost = creds.coHosts.some(c => c.email.toLowerCase() === ownerCreds.ownerEmail!.toLowerCase());
      }

      if (!isOwner && !isCoHost) {
        try {
          const userDrive = getAuthorizedDriveClient(ownerCreds);
          const folderCheck = await userDrive.files.get({
            fileId: folderId,
            fields: "capabilities(canEdit, canDelete, canAddChildren), owners",
          });
          const caps = folderCheck.data.capabilities;
          if (caps?.canEdit || caps?.canDelete || caps?.canAddChildren) {
            isCoHost = true;
          }
        } catch (e) {
          // Folder not shared with user or insufficient permissions
        }
      }
    }

    const canEdit = isOwner || isCoHost;
    const isHostOrCoHost = isOwner || isCoHost;
    const userRole = isOwner ? "owner" : (isCoHost ? "cohost" : "guest");

    // If a custom folderId is specified, fetch its metadata to get the name
    let folderName = creds.folderName || "App Uploads Gallery";
    if (queryFolderId && queryFolderId !== creds.folderId) {
      try {
        const folderMeta = await drive.files.get({
          fileId: queryFolderId,
          fields: "name",
        });
        folderName = folderMeta.data.name || "Shared Gallery";
      } catch (err) {
        console.error("Failed fetching guest folder metadata:", err);
        folderName = "Shared Gallery";
      }
    }

    let allFiles: any[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const driveRes: any = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType, createdTime, size, thumbnailLink)",
        orderBy: "createdTime desc",
        pageSize: 1000,
        pageToken: pageToken,
      });

      if (driveRes.data.files && driveRes.data.files.length > 0) {
        allFiles.push(...driveRes.data.files);
      }
      pageToken = driveRes.data.nextPageToken || undefined;
    } while (pageToken);
    const hideGuestGallery = !!creds.hideGuestGallery;

    // If Private Guest Mode is active AND caller is a guest (not owner or co-host)
    if (hideGuestGallery && !isHostOrCoHost) {
      allFiles = allFiles.filter(file => file.id && myUploadIds.includes(file.id));
    }

    res.json({
      connected: true,
      folderId: folderId,
      folderName: folderName,
      hideGuestGallery: hideGuestGallery,
      photos: allFiles,
      isOwner: isOwner,
      isHost: isHostOrCoHost,
      isCoHost: isCoHost,
      canEdit: canEdit,
      userRole: userRole,
      userEmail: ownerCreds?.ownerEmail || (isCoHost ? "Co-Host Moderator" : null),
      coHostKey: isHostOrCoHost ? creds.coHostKey : undefined,
      coHosts: creds.coHosts || [],
    });
  } catch (err: any) {
    console.error("Error querying gallery photo list:", err);
    res.status(500).json({ error: err.message || "Failed to scan Google Drive folder." });
  }
});

// 6. Direct secure image streaming proxy (bypasses permissions roadblock)
app.get("/api/photos/view/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const queryFolderId = req.query.folderId as string;
  const sessionId = (req as any).sessionId;

  // 1. Instant local playback if recently uploaded (bypasses Google Drive 10s processing delay)
  const cached = recentUploadsCache.get(fileId);
  if (cached && fs.existsSync(cached.path) && cached.expires > Date.now()) {
    let mimeType = cached.mimeType;
    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod|macintosh|mac os/i.test(userAgent);

    // Apple devices (iPhone/Safari) strictly require video/quicktime to use Apple hardware decoders
    // Non-Apple browsers (Chrome, Android) require video/mp4
    if (mimeType === "video/quicktime") {
      mimeType = isAppleDevice ? "video/quicktime" : "video/mp4";
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const stat = fs.statSync(cached.path);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize || start > end) {
        res.setHeader("Content-Range", `bytes */${fileSize}`);
        return res.status(416).end();
      }

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(cached.path, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": mimeType,
      });
      return file.pipe(res);
    } else {
      res.setHeader("Content-Length", fileSize);
      return fs.createReadStream(cached.path).pipe(res);
    }
  }

  // 2. Otherwise stream from Google Drive with mime caching
  try {
    let creds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    if (!creds) {
      creds = await getSavedCredentials(sessionId);
    }
    if (!creds) {
      return res.status(404).send("Google Drive connection not found.");
    }
    const drive = getAuthorizedDriveClient(creds);

    let cachedInfo = fileMimeCache.get(fileId);
    let mimeType = cachedInfo?.mimeType;
    if (!mimeType) {
      const metadata = await drive.files.get({
        fileId,
        fields: "mimeType, name",
      });
      const fileName = metadata.data.name || "";
      mimeType = metadata.data.mimeType || "image/jpeg";
      if (fileName.toLowerCase().endsWith(".mov") || mimeType === "video/quicktime") {
        mimeType = "video/quicktime";
      }
      fileMimeCache.set(fileId, { mimeType, expires: Date.now() + 30 * 60 * 1000 });
    }

    const userAgent = (req.headers["user-agent"] || "").toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod|macintosh|mac os/i.test(userAgent);

    // Apple devices (iPhone/Safari) require video/quicktime for .mov files
    // Non-Apple browsers require video/mp4
    let responseMimeType = mimeType;
    if (responseMimeType === "video/quicktime") {
      responseMimeType = isAppleDevice ? "video/quicktime" : "video/mp4";
    }

    res.setHeader("Content-Type", responseMimeType);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const requestHeaders: Record<string, string> = {};
    if (req.headers.range) {
      requestHeaders["Range"] = req.headers.range;
    }

    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream", headers: requestHeaders }
    );

    const contentRange = getResponseHeader(response.headers, "content-range");
    const contentLength = getResponseHeader(response.headers, "content-length");

    if (response.status === 206) {
      res.status(206);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (contentLength) res.setHeader("Content-Length", contentLength);
    } else if (req.headers.range && contentLength) {
      // If client sent Range but Google returned 200, format 206 Partial Content header for Safari compatibility
      const totalSize = contentLength;
      res.status(206);
      res.setHeader("Content-Range", `bytes 0-${parseInt(totalSize, 10) - 1}/${totalSize}`);
      res.setHeader("Content-Length", contentLength);
    } else if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    response.data.pipe(res);
  } catch (err: any) {
    console.error("Image proxy fetch failed:", err);
    res.status(404).send("Image not found or loading failed.");
  }
});

// Ensure public reader permission for a file (needed for Google Drive's embedded web preview player)
app.post("/api/photos/ensure-permission/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const queryFolderId = req.query.folderId as string;
  const sessionId = (req as any).sessionId;

  try {
    let creds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    if (!creds) creds = await getSavedCredentials(sessionId);
    if (!creds) creds = getFileFallbackCredentials();
    if (!creds) return res.status(404).json({ error: "Credentials not found." });

    const drive = getAuthorizedDriveClient(creds);
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
        allowFileDiscovery: false,
      },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.json({ success: true, note: err.message });
  }
});

// 7. Client-Free upload from public guest
app.post("/api/upload", (req, res, next) => {
  upload.single("photo")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File size exceeds the 100MB limit." });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(500).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please attach a valid photo or video file." });
  }

  // Verify only images or videos are uploaded to the public directory
  if (!req.file.mimetype.startsWith("image/") && !req.file.mimetype.startsWith("video/")) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(400).json({ error: "Only image and video files (jpeg/png/mp4/mov/etc) are supported." });
  }

  try {
    const queryFolderId = (req.body.folderId || req.query.folderId) as string;
    const sessionId = (req as any).sessionId;
    
    let creds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    if (!creds) {
      creds = await getSavedCredentials(sessionId);
    }
    const targetFolderId = queryFolderId || (creds ? creds.folderId : null);

    if (!creds || !targetFolderId) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: "No active destination folder has been selected. Ask the owner to select a gallery of preference first." });
    }

    const drive = getAuthorizedDriveClient(creds);

    // Optionally prefix the filename with the uploader's name
    const uploaderName = (req.body.uploaderName || "").toString().trim().slice(0, 60);
    const rawName = req.file.originalname;
    const finalFileName = uploaderName ? `${uploaderName} - ${rawName}` : rawName;

    const fileMetadata = {
      name: finalFileName,
      parents: [targetFolderId],
    };

    const fileSize = fs.statSync(req.file.path).size;
    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path),
    };

    let driveResponse;
    if (fileSize > 5 * 1024 * 1024) {
      // For files > 5MB (videos & high-res images), use resumable upload to bypass multipart 5MB limit
      driveResponse = await drive.files.create(
        {
          requestBody: fileMetadata,
          media: media,
          fields: "id, name, mimeType, thumbnailLink, createdTime, size",
        },
        {
          params: { uploadType: "resumable" },
        }
      );
    } else {
      driveResponse = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, name, mimeType, thumbnailLink, createdTime, size",
      });
    }

    // Grant anyone with link read permission so Google Drive's preview player works for all guests
    try {
      await drive.permissions.create({
        fileId: driveResponse.data.id,
        requestBody: {
          role: "reader",
          type: "anyone",
          allowFileDiscovery: false,
        },
      });
    } catch (permErr) {
      console.warn("Could not set anyoneWithLink permission on upload:", permErr);
    }

    // Cache uploaded file for 5 minutes so immediate playback by guests/uploaders starts in 0.01s
    recentUploadsCache.set(driveResponse.data.id, {
      path: req.file.path,
      mimeType: driveResponse.data.mimeType || req.file.mimetype,
      expires: Date.now() + 5 * 60 * 1000,
    });
    fileMimeCache.set(driveResponse.data.id, {
      mimeType: driveResponse.data.mimeType || req.file.mimetype,
      expires: Date.now() + 30 * 60 * 1000,
    });

    res.json({
      success: true,
      fileId: driveResponse.data.id,
      name: driveResponse.data.name,
      uploaderName: uploaderName || null,
      file: {
        id: driveResponse.data.id,
        name: driveResponse.data.name,
        mimeType: driveResponse.data.mimeType || req.file.mimetype,
        thumbnailLink: driveResponse.data.thumbnailLink || null,
        createdTime: driveResponse.data.createdTime || new Date().toISOString(),
        size: driveResponse.data.size || String(fileSize),
      },
    });
  } catch (err: any) {
    console.error("File upload operation failed:", err);
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: err.message || "Failed uploading request to drive storage." });
  }
});

// 8. Delete / Trash accidental guest uploads (Owner or authorized co-host only)
app.post("/api/delete/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const queryFolderId = req.query.folderId as string;
  const sessionId = (req as any).sessionId;
  const reqCoHostKey = (req.query.key || req.query.cohostKey || req.headers["x-cohost-key"]) as string | undefined;
  try {
    let folderCreds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    let userCreds = await getSavedCredentials(sessionId);
    if (!folderCreds && userCreds?.folderId) {
      folderCreds = userCreds;
    }

    const isOwner = Boolean(
      userCreds?.refreshToken &&
      ((folderCreds?.ownerEmail && userCreds.ownerEmail && folderCreds.ownerEmail.toLowerCase() === userCreds.ownerEmail.toLowerCase()) ||
       (userCreds.folderId && userCreds.folderId === queryFolderId))
    );

    const isCoHost = Boolean(
      folderCreds?.coHostKey &&
      reqCoHostKey &&
      reqCoHostKey.trim() === folderCreds.coHostKey.trim()
    );

    if (!isOwner && !isCoHost) {
      return res.status(403).json({ error: "Only the album owner or an authorized co-host can delete photos." });
    }

    const driveCreds = folderCreds || userCreds;
    if (!driveCreds) {
      return res.status(400).json({ error: "Google Drive is not connected." });
    }
    const drive = getAuthorizedDriveClient(driveCreds);
    
    await drive.files.update({
      fileId,
      requestBody: {
        trashed: true,
      },
    });

    res.json({ success: true, message: "Photo successfully sent to owner's drive trash bin." });
  } catch (err: any) {
    console.error("Photo trashing failed:", err);
    res.status(500).json({ error: err.message || "Owner trashing execution failure." });
  }
});

// 9. List Google Drive Folders
app.get("/api/folders", async (req, res) => {
  const sessionId = (req as any).sessionId;
  try {
    const creds = await getSavedCredentials(sessionId);
    if (!creds) {
      return res.json({ folders: [] });
    }
    const drive = getAuthorizedDriveClient(creds);
    let allFolders: any[] = [];
    let folderPageToken: string | undefined = undefined;

    do {
      const driveRes: any = await drive.files.list({
        q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields: "nextPageToken, files(id, name)",
        orderBy: "name",
        pageSize: 1000,
        pageToken: folderPageToken,
      });
      if (driveRes.data.files && driveRes.data.files.length > 0) {
        allFolders.push(...driveRes.data.files);
      }
      folderPageToken = driveRes.data.nextPageToken || undefined;
    } while (folderPageToken);

    res.json({ folders: allFolders });
  } catch (err: any) {
    console.error("Error listing folders:", err);
    // If we're on limited drive.file scope, full folder scan is restricted. Return an empty list gracefully
    res.json({ folders: [], limitedScope: true, warning: err.message || "Limited Scope" });
  }
});

// 10. Select Active Folder
app.post("/api/folders/select", async (req, res) => {
  const { folderId, folderName } = req.body;
  const sessionId = (req as any).sessionId;
  if (!folderId || !folderName) {
    return res.status(400).json({ error: "Missing folderId or folderName" });
  }
  try {
    const creds = await getSavedCredentials(sessionId);
    if (!creds) {
      return res.status(400).json({ error: "Google Drive is not connected." });
    }
    creds.folderId = folderId;
    creds.folderName = folderName;
    await saveCredentials(sessionId, creds);
    res.json({ success: true, folderId, folderName });
  } catch (err: any) {
    console.error("Folder select error:", err);
    res.status(500).json({ error: err.message || "Failed to update folder preference." });
  }
});

// 11. Create and Select New Folder
app.post("/api/folders/create", async (req, res) => {
  const { name } = req.body;
  const sessionId = (req as any).sessionId;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Folder name is required." });
  }
  try {
    const creds = await getSavedCredentials(sessionId);
    if (!creds) {
      return res.status(400).json({ error: "Google Drive is not connected." });
    }
    const drive = getAuthorizedDriveClient(creds);
    const fileMetadata = {
      name: name.trim(),
      mimeType: "application/vnd.google-apps.folder",
    };
    const folderRes = await drive.files.create({
      requestBody: fileMetadata,
      fields: "id, name",
    });
    
    const newFolderId = folderRes.data.id!;
    const newFolderName = folderRes.data.name!;
    
    creds.folderId = newFolderId;
    creds.folderName = newFolderName;
    await saveCredentials(sessionId, creds);
    
    res.json({ success: true, folderId: newFolderId, folderName: newFolderName });
  } catch (err: any) {
    console.error("Folder create error:", err);
    res.status(500).json({ error: err.message || "Failed to create folder." });
  }
});

// 12. Get Gallery Settings (public — guests read this to know configuration)
app.get("/api/settings", async (req, res) => {
  const queryFolderId = req.query.folderId as string;
  const sessionId = (req as any).sessionId;
  try {
    let creds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    if (!creds) {
      creds = await getSavedCredentials(sessionId);
    }
    if (!creds) {
      return res.json({ allowGuestNames: false, hideGuestGallery: false });
    }
    res.json({
      allowGuestNames: !!creds.allowGuestNames,
      hideGuestGallery: !!creds.hideGuestGallery
    });
  } catch (err: any) {
    console.error("Error fetching settings:", err);
    res.json({ allowGuestNames: false, hideGuestGallery: false });
  }
});

// 13. Update Gallery Settings (owner or authorized co-host)
app.post("/api/settings", async (req, res) => {
  const sessionId = (req as any).sessionId;
  const { allowGuestNames, hideGuestGallery, folderId: reqFolderId, key: bodyKey } = req.body;
  const reqCoHostKey = (bodyKey || req.headers["x-cohost-key"]) as string | undefined;
  try {
    let creds = await getSavedCredentials(sessionId);
    const targetFolderId = reqFolderId || creds?.folderId;
    if (!creds && targetFolderId) {
      const folderCreds = await getSavedCredentialsForFolder(targetFolderId);
      if (folderCreds && folderCreds.coHostKey && reqCoHostKey && reqCoHostKey.trim() === folderCreds.coHostKey.trim()) {
        creds = folderCreds;
      }
    }
    if (!creds) {
      return res.status(400).json({ error: "Not authenticated. You must be the gallery owner or co-host." });
    }
    if (allowGuestNames !== undefined) creds.allowGuestNames = !!allowGuestNames;
    if (hideGuestGallery !== undefined) creds.hideGuestGallery = !!hideGuestGallery;
    await saveCredentials(sessionId, creds);
    if (targetFolderId) {
      await updateFolderCredentials(targetFolderId, {
        allowGuestNames: creds.allowGuestNames,
        hideGuestGallery: creds.hideGuestGallery,
      });
    }
    res.json({
      success: true,
      allowGuestNames: creds.allowGuestNames,
      hideGuestGallery: creds.hideGuestGallery
    });
  } catch (err: any) {
    console.error("Error saving settings:", err);
    res.status(500).json({ error: err.message || "Failed to save settings." });
  }
});

// 14. Get Co-Hosts for Active Folder
app.get("/api/cohosts", async (req, res) => {
  const queryFolderId = req.query.folderId as string;
  const sessionId = (req as any).sessionId;
  try {
    let creds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    if (!creds) {
      creds = await getSavedCredentials(sessionId);
    }
    if (!creds) {
      return res.json({ coHosts: [] });
    }
    const targetFolderId = queryFolderId || creds.folderId;
    if (targetFolderId && !creds.coHostKey) {
      creds.coHostKey = crypto.randomBytes(16).toString("hex");
      await updateFolderCredentials(targetFolderId, { coHostKey: creds.coHostKey });
    }
    res.json({
      coHosts: creds.coHosts || [],
      ownerEmail: creds.ownerEmail || null,
      coHostKey: creds.coHostKey || undefined,
    });
  } catch (err: any) {
    console.error("Error fetching co-hosts:", err);
    res.status(500).json({ error: err.message || "Failed to fetch co-hosts." });
  }
});

// 15. Invite Co-Host (Owner only: sets Google Drive permission + saves to coHosts)
app.post("/api/cohosts", async (req, res) => {
  const sessionId = (req as any).sessionId;
  const { email, folderId: reqFolderId } = req.body;
  try {
    const creds = await getSavedCredentials(sessionId);
    if (!creds || !creds.refreshToken) {
      return res.status(401).json({ error: "Only the album owner can invite co-hosts." });
    }

    const folderId = reqFolderId || creds.folderId;
    if (!folderId) {
      return res.status(400).json({ error: "No active Google Drive folder selected." });
    }

    const cleanEmail = (email || "").toString().trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }

    if (creds.ownerEmail && cleanEmail === creds.ownerEmail.toLowerCase()) {
      return res.status(400).json({ error: "You are already the owner of this album." });
    }

    const currentCoHosts: CoHostInfo[] = creds.coHosts || [];
    if (currentCoHosts.some(c => c.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: `${cleanEmail} is already invited as a co-host.` });
    }

    // Call Google Drive API to grant writer (Editor) permissions
    const drive = getAuthorizedDriveClient(creds);
    let permissionId: string | undefined = undefined;
    let driveShared = false;

    try {
      const permRes = await drive.permissions.create({
        fileId: folderId,
        sendNotificationEmail: true,
        requestBody: {
          role: "writer",
          type: "user",
          emailAddress: cleanEmail,
        },
      });
      if (permRes.data.id) {
        permissionId = permRes.data.id;
        driveShared = true;
      }
    } catch (driveErr: any) {
      console.warn("Drive permissions.create warning (saving to app co-hosts anyway):", driveErr.message);
    }

    const newCoHost: CoHostInfo = {
      email: cleanEmail,
      permissionId,
      addedAt: Date.now(),
    };

    const updatedCoHosts = [...currentCoHosts, newCoHost];
    creds.coHosts = updatedCoHosts;
    await saveCredentials(sessionId, creds);
    await updateFolderCredentials(folderId, { coHosts: updatedCoHosts });

    res.json({
      success: true,
      coHosts: updatedCoHosts,
      driveShared,
      message: driveShared
        ? `Co-host invited! Google Drive sent an invite to ${cleanEmail}.`
        : `Co-host added! ${cleanEmail} can now moderate when signed in.`
    });
  } catch (err: any) {
    console.error("Error inviting co-host:", err);
    res.status(500).json({ error: err.message || "Failed to invite co-host." });
  }
});

// 16. Remove Co-Host (Owner only)
app.delete("/api/cohosts", async (req, res) => {
  const sessionId = (req as any).sessionId;
  const { email, folderId: reqFolderId } = req.body;
  try {
    const creds = await getSavedCredentials(sessionId);
    if (!creds || !creds.refreshToken) {
      return res.status(401).json({ error: "Only the album owner can remove co-hosts." });
    }

    const folderId = reqFolderId || creds.folderId;
    if (!folderId) {
      return res.status(400).json({ error: "No active Google Drive folder selected." });
    }

    const cleanEmail = (email || "").toString().trim().toLowerCase();
    const currentCoHosts: CoHostInfo[] = creds.coHosts || [];
    const target = currentCoHosts.find(c => c.email.toLowerCase() === cleanEmail);

    if (target && target.permissionId) {
      try {
        const drive = getAuthorizedDriveClient(creds);
        await drive.permissions.delete({
          fileId: folderId,
          permissionId: target.permissionId,
        });
      } catch (driveErr: any) {
        console.warn("Drive permissions.delete warning:", driveErr.message);
      }
    }

    const updatedCoHosts = currentCoHosts.filter(c => c.email.toLowerCase() !== cleanEmail);
    creds.coHosts = updatedCoHosts;
    await saveCredentials(sessionId, creds);
    await updateFolderCredentials(folderId, { coHosts: updatedCoHosts });

    res.json({
      success: true,
      coHosts: updatedCoHosts,
      message: `Removed ${cleanEmail} from co-hosts.`
    });
  } catch (err: any) {
    console.error("Error removing co-host:", err);
    res.status(500).json({ error: err.message || "Failed to remove co-host." });
  }
});

// Setup dev server with Vite middlewares, otherwise static file hosting for production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer();
