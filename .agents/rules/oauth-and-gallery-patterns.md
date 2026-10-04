# OAuth and Media Gallery Architectural Patterns

## 1. OAuth Redirect URI Integrity
- **Strict Origin Cleanliness**: The OAuth `redirect_uri` sent to Google must strictly consist of `<protocol>://<domain>[:<port>]/api/oauth/callback`.
- **Never Include Query Strings in `redirect_uri`**: Do not append query strings, path parameters, or hashes to the `redirect_uri`. Any query string in `redirect_uri` causes Google OAuth to reject authentication with `Error 400: invalid_request` ("Access blocked: This app's request is invalid").
- **Use `state` for Deep Linking**: Always serialize deep-link parameters (such as `folderId`, `role`, or return paths) into the OAuth `state` parameter, and decode them in the `/api/oauth/callback` handler upon successful redirection.

## 2. Fast Guest View Performance
- **Parallelize Startup Requests**: Never chain independent frontend API calls sequentially with `await`. Use `Promise.all` to fetch initial data (e.g., status and photo list) concurrently.
- **Bypass Host Operations for Guests**: Do not execute administrative Google Drive calls (e.g. `storageQuota` via `drive.about.get` or capability checks) when serving unauthenticated guests.
- **In-Memory Caching for Burst Reads**: Cache photo listings (`photosListCache`, 15s TTL) and folder names to handle traffic surges (e.g., event guests scanning QR codes) with sub-10ms response times. Always invalidate caches immediately upon `/api/upload`, `/api/delete`, or folder selection.
- **Grid Thumbnail Sizing**: Serve appropriately sized thumbnails (e.g. `=s400`) in photo grids rather than oversized `=s600` or full originals, preserving bandwidth and memory on mobile devices.

## 3. UI Animation Guardrails (Framer Motion)
- **No `layout` Prop on Dynamic Grids**: Never apply the `layout` prop to `<motion.div>` on tiles in photo/video galleries or lists with more than 20 items. Layout projection runs synchronous DOM measurements (`getBoundingClientRect`) that freeze the main thread on mobile devices. Use lightweight entry animations (`initial`, `animate`, `exit`) or CSS transitions instead.

## 4. Authoritative Session Lifecycle
- **Single Source of Truth for Sign-Out**: Never implement client-only logout states that only clear `localStorage` while leaving the server-side session cookie active. Always route user logouts through `/api/disconnect` to ensure cookies and backend session stores are cleanly destroyed.
