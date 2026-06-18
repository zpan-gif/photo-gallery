# GuestDrive Gallery

A modern, responsive, and secure photo gallery web application that allows guests at an event (like weddings, parties, or conferences) to upload photos directly to a host's Google Drive folder. Guests do not need to sign in or have a Google account to upload or view the shared gallery.

## Features

- **Google Drive Storage:** Securely stores all uploaded images directly in a folder on the host's Google Drive.
- **Client-Free Uploads:** Guests can upload photos from their mobile devices or desktops without logging in.
- **Dynamic Photo Gallery:** A modern light-themed gallery with customizable grid layouts, full-screen image previews (lightbox), sorting, and search.
- **Flyers & QR Codes:** Generate flyers with printable QR codes for guests to scan and access the upload portal instantly.
- **ZIP Downloads:** Event hosts can batch-select and download all or selected photos as a ZIP archive.
- **Secure Image Proxying:** Images are served through a secure backend proxy to prevent exposing direct Google Drive URLs.
- **Permanent Light Mode:** Clean, minimalist UI design optimized for both mobile and desktop screens.

---

## Setup & Running Locally

### Prerequisites
- Node.js (v18+)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a file named `.env` in the root directory and add your credentials:
```env
APP_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/oauth/callback"
```

### 3. Run the App
To start the app in development mode:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

---

## Production Build & Local Test

To build the project and test the production-ready build locally:

1. Compile the React frontend and build the server:
   ```bash
   npm run build
   ```
2. Start the production server:
   ```bash
   $env:NODE_ENV="production"; npm start
   ```

---

## Deploying to Render

1. Push this project to your GitHub account (ensure your `.env` and `drive-credentials.json` are **not** pushed—they are already ignored by `.gitignore`).
2. Create a new **Web Service** on [Render](https://render.com).
3. Connect your GitHub repository.
4. Configure these settings:
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
5. Under **Environment**, add the following keys:
   - `NODE_ENV`: `production`
   - `GOOGLE_CLIENT_ID`: `(Your Google Client ID)`
   - `GOOGLE_CLIENT_SECRET`: `(Your Google Client Secret)`
   - `APP_URL`: `(The live URL Render assigns to your app, e.g. https://your-app.onrender.com)`
6. Add your new Render URL (`https://your-app.onrender.com/api/oauth/callback`) to the **Authorized redirect URIs** in your Google Cloud Console.
