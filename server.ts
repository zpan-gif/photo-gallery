import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { google } from "googleapis";
import multer from "multer";

dotenv.config();

// Safe fallback path variables are not needed since we use process.cwd() for persistent file resolution

const app = express();
const PORT = 3000;

app.use(express.json());

const CREDENTIALS_PATH = path.join(process.cwd(), "drive-credentials.json");

interface SavedCredentials {
  refreshToken: string;
  folderId?: string;
  folderName?: string;
  ownerEmail?: string;
}

// Read saved credentials containing OAuth refresh token and created folder ID
function getSavedCredentials(): SavedCredentials | null {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const data = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
      return JSON.parse(data);
    } catch (e) {
      console.error("Error reading saved credentials:", e);
    }
  }
  return null;
}

// Save credentials safely to persist connection across dev container restarts
function saveCredentials(creds: SavedCredentials) {
  try {
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), "utf-8");
  } catch (e) {
    console.error("Error writing credentials file:", e);
  }
}

// Delete credentials (disconnect)
function deleteCredentials() {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      fs.unlinkSync(CREDENTIALS_PATH);
    } catch (e) {
      console.error("Error deleting credentials file:", e);
    }
  }
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
function getAuthorizedDriveClient() {
  const creds = getSavedCredentials();
  if (!creds || !creds.refreshToken) {
    throw new Error("Google Drive is not connected. Authenticate as the Owner first.");
  }
  
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: creds.refreshToken
  });
  
  return google.drive({ version: "v3", auth: oauth2Client });
}

// Configure multer to save uploads to the OS temp directory
const upload = multer({ dest: os.tmpdir() });

// 1. App Connection & Auth Status Endpoint
app.get("/api/status", async (req, res) => {
  const creds = getSavedCredentials();
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
            saveCredentials(creds);
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
      const drive = getAuthorizedDriveClient();
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
      const currentCreds = getSavedCredentials();
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
    const currentCreds = getSavedCredentials();
    
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

    saveCredentials({
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
app.post("/api/disconnect", (req, res) => {
  deleteCredentials();
  res.json({ success: true });
});

// 5. Gallery Photo Listing
app.get("/api/photos", async (req, res) => {
  const queryFolderId = req.query.folderId as string;
  try {
    const creds = getSavedCredentials();
    if (!creds) {
      return res.json({ connected: false, photos: [] });
    }

    const folderId = queryFolderId || creds.folderId;
    if (!folderId) {
      return res.json({ connected: false, photos: [] });
    }

    const drive = getAuthorizedDriveClient();
    
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
      pageSize: 50,
    });

    res.json({
      connected: true,
      folderId: folderId,
      folderName: folderName,
      photos: driveRes.data.files || []
    });
  } catch (err: any) {
    console.error("Error querying gallery photo list:", err);
    res.status(500).json({ error: err.message || "Failed to scan Google Drive folder." });
  }
});

// 6. Direct secure image streaming proxy (bypasses permissions roadblock)
app.get("/api/photos/view/:fileId", async (req, res) => {
  const { fileId } = req.params;
  try {
    const drive = getAuthorizedDriveClient();

    const metadata = await drive.files.get({
      fileId,
      fields: "mimeType, name",
    });

    const mimeType = metadata.data.mimeType || "image/jpeg";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=3600");

    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    response.data.pipe(res);
  } catch (err: any) {
    console.error("Image proxy fetch failed:", err);
    res.status(404).send("Image not found or loading failed.");
  }
});

// 7. Client-Free upload from public guest
app.post("/api/upload", upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please attach a valid photo file." });
  }

  // Verify only images are uploaded to the public directory
  if (!req.file.mimetype.startsWith("image/")) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(400).json({ error: "Only image files (jpeg/png/gif/etc) are supported." });
  }

  try {
    const creds = getSavedCredentials();
    const queryFolderId = (req.body.folderId || req.query.folderId) as string;
    const targetFolderId = queryFolderId || (creds ? creds.folderId : null);

    if (!creds || !targetFolderId) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: "No active destination folder has been selected. Ask the owner to select a gallery of preference first." });
    }

    const drive = getAuthorizedDriveClient();

    const fileMetadata = {
      name: req.file.originalname,
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
  try {
    const drive = getAuthorizedDriveClient();
    
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
  try {
    const drive = getAuthorizedDriveClient();
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
  if (!folderId || !folderName) {
    return res.status(400).json({ error: "Missing folderId or folderName" });
  }
  try {
    const creds = getSavedCredentials();
    if (!creds) {
      return res.status(400).json({ error: "Google Drive is not connected." });
    }
    creds.folderId = folderId;
    creds.folderName = folderName;
    saveCredentials(creds);
    res.json({ success: true, folderId, folderName });
  } catch (err: any) {
    console.error("Folder select error:", err);
    res.status(500).json({ error: err.message || "Failed to update folder preference." });
  }
});

// 11. Create and Select New Folder
app.post("/api/folders/create", async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Folder name is required." });
  }
  try {
    const creds = getSavedCredentials();
    if (!creds) {
      return res.status(400).json({ error: "Google Drive is not connected." });
    }
    const drive = getAuthorizedDriveClient();
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
    saveCredentials(creds);
    
    res.json({ success: true, folderId: newFolderId, folderName: newFolderName });
  } catch (err: any) {
    console.error("Folder create error:", err);
    res.status(500).json({ error: err.message || "Failed to create folder." });
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
