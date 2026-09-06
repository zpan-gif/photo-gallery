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

interface SavedCredentials {
  refreshToken: string;
  folderId?: string;
  folderName?: string;
  ownerEmail?: string;
  allowGuestNames?: boolean;
  hideGuestGallery?: boolean;
}

// Fast In-Memory Credentials Cache to eliminate Firestore roundtrip latency during batch uploads
const sessionCredentialsCache = new Map<string, { data: SavedCredentials; expires: number }>();
const folderCredentialsCache = new Map<string, { data: SavedCredentials; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Read saved credentials containing OAuth refresh token and created folder ID from Firestore
async function getSavedCredentials(sessionId: string): Promise<SavedCredentials | null> {
  const cached = sessionCredentialsCache.get(sessionId);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  if (!db) {
    console.error("Firebase Firestore is not initialized.");
    return null;
  }
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
  return null;
}

// Save credentials safely to Firestore
async function saveCredentials(sessionId: string, creds: SavedCredentials) {
  sessionCredentialsCache.set(sessionId, { data: creds, expires: Date.now() + CACHE_TTL_MS });
  if (creds.folderId) {
    folderCredentialsCache.set(creds.folderId, { data: creds, expires: Date.now() + CACHE_TTL_MS });
  }

  if (!db) {
    console.error("Firebase Firestore is not initialized.");
    return;
  }
  try {
    await db.collection("sessions").doc(sessionId).set(creds, { merge: true });
  } catch (e) {
    console.error("Error writing credentials to Firestore:", e);
  }
}

// Delete credentials (disconnect)
async function deleteCredentials(sessionId: string) {
  const cached = sessionCredentialsCache.get(sessionId);
  if (cached?.data?.folderId) {
    folderCredentialsCache.delete(cached.data.folderId);
  }
  sessionCredentialsCache.delete(sessionId);

  if (!db) {
    console.error("Firebase Firestore is not initialized.");
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

  res.json({
    connected: !!(creds && creds.refreshToken),
    folderId: creds ? creds.folderId : null,
    folderName: creds ? (creds.folderName || "App Uploads Gallery") : null,
    ownerEmail: ownerEmail || null,
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
      prompt: "consent", // Necessary to guarantee a refresh_token is returned
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
  res.json({ success: true });
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
    
    // Check if the current session is the owner/host of this folder
    const isOwner = !!(ownerCreds && ownerCreds.refreshToken && ownerCreds.folderId === folderId);

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

    const driveRes = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, createdTime, size, thumbnailLink)",
      orderBy: "createdTime desc",
      pageSize: 100,
    });

    let allFiles = driveRes.data.files || [];
    const hideGuestGallery = !!creds.hideGuestGallery;

    // If Private Guest Mode is active AND caller is a guest (not owner)
    if (hideGuestGallery && !isOwner) {
      allFiles = allFiles.filter(file => file.id && myUploadIds.includes(file.id));
    }

    res.json({
      connected: true,
      folderId: folderId,
      folderName: folderName,
      hideGuestGallery: hideGuestGallery,
      photos: allFiles
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
  try {
    let creds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    if (!creds) {
      creds = await getSavedCredentials(sessionId);
    }
    if (!creds) {
      return res.status(404).send("Google Drive connection not found.");
    }
    const drive = getAuthorizedDriveClient(creds);

    const metadata = await drive.files.get({
      fileId,
      fields: "mimeType, name",
    });

    const mimeType = metadata.data.mimeType || "image/jpeg";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=3600");

    const requestHeaders: Record<string, string> = {};
    if (req.headers.range) {
      requestHeaders["Range"] = req.headers.range;
    }

    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream", headers: requestHeaders }
    );

    if (response.status === 206) {
      res.status(206);
      if (response.headers["content-range"]) res.setHeader("Content-Range", response.headers["content-range"]);
      if (response.headers["accept-ranges"]) res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
      if (response.headers["content-length"]) res.setHeader("Content-Length", response.headers["content-length"]);
    }

    response.data.pipe(res);
  } catch (err: any) {
    console.error("Image proxy fetch failed:", err);
    res.status(404).send("Image not found or loading failed.");
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

    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path),
    };

    const driveResponse = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, name",
    });

    // Delete temp file after successful Drive upload
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      console.error("Temp file garbage cleanup fail:", e);
    }

    res.json({
      success: true,
      fileId: driveResponse.data.id,
      name: driveResponse.data.name,
      uploaderName: uploaderName || null,
    });
  } catch (err: any) {
    console.error("File upload operation failed:", err);
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: err.message || "Failed uploading request to drive storage." });
  }
});

// 8. Delete / Trash accidental guest uploads
app.post("/api/delete/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const queryFolderId = req.query.folderId as string;
  const sessionId = (req as any).sessionId;
  try {
    let creds = queryFolderId ? await getSavedCredentialsForFolder(queryFolderId) : null;
    if (!creds) {
      creds = await getSavedCredentials(sessionId);
    }
    if (!creds) {
      return res.status(400).json({ error: "Google Drive is not connected." });
    }
    const drive = getAuthorizedDriveClient(creds);
    
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
    const driveRes = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: "files(id, name)",
      orderBy: "name",
      pageSize: 100,
    });
    res.json({ folders: driveRes.data.files || [] });
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

// 13. Update Gallery Settings (owner-only — session gated)
app.post("/api/settings", async (req, res) => {
  const sessionId = (req as any).sessionId;
  const { allowGuestNames, hideGuestGallery } = req.body;
  try {
    const creds = await getSavedCredentials(sessionId);
    if (!creds) {
      return res.status(400).json({ error: "Not authenticated. You must be the gallery owner." });
    }
    if (allowGuestNames !== undefined) creds.allowGuestNames = !!allowGuestNames;
    if (hideGuestGallery !== undefined) creds.hideGuestGallery = !!hideGuestGallery;
    await saveCredentials(sessionId, creds);
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
