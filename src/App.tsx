import React, { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import { 
  Upload, 
  Trash2, 
  Settings, 
  AlertCircle, 
  CheckCircle, 
  RefreshCw, 
  Lock, 
  FolderOpen,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  SlidersHorizontal,
  Grid,
  ArrowUpDown,
  Check,
  Calendar,
  Image as ImageIcon,
  FolderPlus,
  Tv,
  Download,
  QrCode,
  ExternalLink,
  Sun,
  Moon,
  HardDrive,
  AlertTriangle,
  Users,
  Sparkles,
  Copy
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { QRCodeSVG } from "qrcode.react";

interface Photo {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
}

interface ServerStatus {
  connected: boolean;
  folderId: string | null;
  folderName: string | null;
  ownerEmail?: string | null;
  envConfigured: boolean;
  storageQuota?: {
    limit: string;
    usage: string;
    percentageUsed: number;
    isNearingLimit: boolean;
  } | null;
  missingEnv: {
    GOOGLE_CLIENT_ID: boolean;
    GOOGLE_CLIENT_SECRET: boolean;
    APP_URL: boolean;
  };
  diagnostics?: {
    redirectUri: string;
    hasWhitespace: boolean;
    isValidSuffix: boolean;
    clientIdLength: number;
    clientSecretLength: number;
    clientIdPreview: string;
  };
}

interface DriveFolder {
  id: string;
  name: string;
}

const DEMO_PHOTOS: Photo[] = [
  {
    id: "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&q=80&w=800",
    name: "Wedding Toast Sparklers.jpg",
    mimeType: "image/jpeg",
    createdTime: new Date(Date.now() - 3600000 * 2).toISOString(),
    size: "2450000"
  },
  {
    id: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&q=80&w=800",
    name: "Ceremony Arch Bouquet.jpg",
    mimeType: "image/jpeg",
    createdTime: new Date(Date.now() - 3600000 * 5).toISOString(),
    size: "1820000"
  },
  {
    id: "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?auto=format&fit=crop&q=80&w=800",
    name: "Champagne Celebrations.jpg",
    mimeType: "image/jpeg",
    createdTime: new Date(Date.now() - 3600000 * 8).toISOString(),
    size: "3200000"
  },
  {
    id: "https://images.unsplash.com/photo-1504196606672-aef5c9cefc92?auto=format&fit=crop&q=80&w=800",
    name: "Garden Gazebo Lighting.jpg",
    mimeType: "image/jpeg",
    createdTime: new Date(Date.now() - 3600000 * 12).toISOString(),
    size: "4105000"
  },
  {
    id: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=800",
    name: "Night Dance Floor.jpg",
    mimeType: "image/jpeg",
    createdTime: new Date(Date.now() - 3600000 * 15).toISOString(),
    size: "1250000"
  },
  {
    id: "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&q=80&w=800",
    name: "Reception Ballroom Balloons.jpg",
    mimeType: "image/jpeg",
    createdTime: new Date(Date.now() - 3600000 * 24).toISOString(),
    size: "1980000"
  }
];

export default function App() {
  const isSandbox = false;
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  
  // Notification States
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Guest view and Link isolation properties
  const [guestFolderId, setGuestFolderId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("folder") || params.get("g") || null;
  });
  const [guestFolderName, setGuestFolderName] = useState<string | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  // Local active upload tracking
  const [myUploads, setMyUploads] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("public_drive_gallery_uploads") || "[]");
    } catch {
      return [];
    }
  });

  // Lightbox view state
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

  // Dark/Light theme state
  const darkMode = false;

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  const isOwner = !guestFolderId && (status?.connected ?? false);

  // Administrative Setup states
  const [showAdminGuide, setShowAdminGuide] = useState(false);
  const useFullScope = false;
  const [isLimitedScope, setIsLimitedScope] = useState(false);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showCastMode, setShowCastMode] = useState(false);

  // In-app browser detection and guides (Instagram, FaceBook, LinkedIn, Slack, etc.)
  const [copiedAppUrl, setCopiedAppUrl] = useState(false);

  // Iframe preview / embed detection states
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    // Detect if running inside an iframe (like standard AI Studio preview wrappers)
    const isIframe = window.self !== window.top;
    setIsInIframe(isIframe);
  }, []);

  const handleCopyAppUrl = async () => {
    let cleanUrl = window.location.origin + window.location.pathname;
    if (cleanUrl.includes("is-dev-")) {
      cleanUrl = cleanUrl.replace("is-dev-", "is-pre-");
    }
    try {
      await navigator.clipboard.writeText(cleanUrl);
      setCopiedAppUrl(true);
      setTimeout(() => setCopiedAppUrl(false), 3000);
    } catch (err) {
      const textArea = document.createElement("textarea");
      textArea.value = cleanUrl;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopiedAppUrl(true);
        setTimeout(() => setCopiedAppUrl(false), 3000);
      } catch (e) {
        console.error("Fallback clipboard failed", e);
      }
      document.body.removeChild(textArea);
    }
  };

  // Track if a folder has been explicitly clicked/selected in the UI after authorizing
  const [hasClickedFolder, setHasClickedFolder] = useState<boolean>(() => {
    return sessionStorage.getItem("photo_deck_folder_clicked") === "true";
  });

  // iPhone Photo Gallery Premium visual states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "mine" | "recent">("all");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "name_asc" | "size_desc">("date_desc");
  const [columnsCount, setColumnsCount] = useState<number>(3); // Slider value 2-6
  const [showFiltersDropdown, setShowFiltersDropdown] = useState(false);

  // Selection states
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [batchActionLabel, setBatchActionLabel] = useState("");
  const [batchActionProgress, setBatchActionProgress] = useState(0);

  // Custom IFrame-Safe Confirmation Modal State
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    onConfirm: (() => void) | null;
    isDestructive?: boolean;
  }>({
    isOpen: false,
    title: "",
    message: "",
    confirmText: "Continue",
    cancelText: "Cancel",
    onConfirm: null,
    isDestructive: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchStatusAndPhotos = async () => {
    try {
      const statusRes = await fetch("/api/status");
      if (!statusRes.ok) throw new Error("Failed to load server auth status");
      const statusData: ServerStatus = await statusRes.json();
      setStatus(statusData);

      // Dynamically fetch photos based on guest or owner view
      const targetFolderId = guestFolderId || statusData.folderId;
      if (targetFolderId) {
        const photoRes = await fetch(`/api/photos?folderId=${targetFolderId}`);
        if (photoRes.ok) {
          const photoData = await photoRes.json();
          setPhotos(photoData.photos || []);
          if (guestFolderId && photoData.folderName) {
            setGuestFolderName(photoData.folderName);
          }
        }
      } else {
        setPhotos([]);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Could not sync backend status.");
    } finally {
      setLoadingPhotos(false);
    }
  };

  // Fetch available folders in owner's Google Drive
  const fetchFoldersList = async () => {
    if (isSandbox) {
      setLoadingFolders(false);
      setFolders([
        { id: "sandbox-demo-folder", name: "Wedding Ceremony 🌸" },
        { id: "sandbox-reception", name: "Guest Reception Ballroom 🎈" },
        { id: "sandbox-honeymoon", name: "Garden Afterparty 🌿" },
      ]);
      setIsLimitedScope(false);
      return;
    }

    if (!status?.connected) return;
    setLoadingFolders(true);
    try {
      const res = await fetch("/api/folders");
      if (res.ok) {
        const data = await res.json();
        setFolders(data.folders || []);
        setIsLimitedScope(!!data.limitedScope);
      }
    } catch (err) {
      console.error("Failed loading folders list:", err);
    } finally {
      setLoadingFolders(false);
    }
  };

  const formatBytes = (bytesStrOrNum: string | number | undefined, decimals = 1) => {
    if (bytesStrOrNum === undefined) return "Unknown";
    const bytes = typeof bytesStrOrNum === "string" ? parseInt(bytesStrOrNum, 10) : bytesStrOrNum;
    if (!bytes || isNaN(bytes) || bytes === 0) {
      if (bytesStrOrNum === "0") return "0 Bytes";
      return "Unlimited / Unknown";
    }
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const getPublicGuestUrl = (folderId: string): string => {
    let origin = window.location.origin;
    // Direct guests to the public preview app URL instead of the private developer iframe URL
    if (origin.includes("ais-dev-")) {
      origin = origin.replace("ais-dev-", "ais-pre-");
    }
    return `${origin}/?folder=${folderId}`;
  };

  const handleCopyShareLink = (folderId: string) => {
    const link = getPublicGuestUrl(folderId);
    navigator.clipboard.writeText(link)
      .then(() => {
        setCopiedShareLink(true);
        setTimeout(() => setCopiedShareLink(false), 2000);
        setSuccessMsg("Shareable guest gallery link copied directly to clipboard!");
      })
      .catch((err) => {
        console.error("Failed to copy link:", err);
        setErrorMsg("Failed to copy link. Please copy URL from browser address bar manually.");
      });
  };

  const handleDownloadQR = () => {
    try {
      const svg = document.querySelector("#owner_guest_share_qr svg") as SVGElement;
      if (!svg) {
        throw new Error("QR Code element not loaded yet.");
      }
      const svgString = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const blobURL = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const ctxWidth = 400;
        const ctxHeight = 400;
        canvas.width = ctxWidth;
        canvas.height = ctxHeight;
        const context = canvas.getContext("2d");
        if (context) {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, ctxWidth, ctxHeight);
          context.drawImage(image, 30, 30, ctxWidth - 60, ctxHeight - 60);
          
          const png = canvas.toDataURL("image/png");
          const downloadLink = document.createElement("a");
          downloadLink.href = png;
          downloadLink.download = `gallery_qr_${status?.folderName || "scan"}.png`;
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
          setSuccessMsg("Successfully downloaded high-res guest flyer QR Code!");
        }
      };
      image.src = blobURL;
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to generate QR image. Feel free to right-click and save the QR code directly.");
    }
  };

  useEffect(() => {
    // Parse redirect flags from URL query
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "connected") {
      setSuccessMsg("Connected! Choose any destination folder from your Google Drive inside the setup menu.");
      setShowAdminGuide(true);
      sessionStorage.removeItem("photo_deck_folder_clicked");
      setHasClickedFolder(false);
    }
    const errorParam = params.get("error");
    const msgParam = params.get("msg");
    if (errorParam) {
      setErrorMsg(msgParam || `Google Drive authentication failed: ${errorParam}`);
    }

    if (window.location.search) {
      const nextParams = new URLSearchParams(window.location.search);
      let changed = false;
      if (nextParams.has("status")) { nextParams.delete("status"); changed = true; }
      if (nextParams.has("error")) { nextParams.delete("error"); changed = true; }
      if (nextParams.has("msg")) { nextParams.delete("msg"); changed = true; }
      
      if (changed) {
        const newSearch = nextParams.toString();
        const newPath = window.location.pathname + (newSearch ? `?${newSearch}` : "");
        window.history.replaceState({}, document.title, newPath);
      }
    }

    fetchStatusAndPhotos();

    // Listen to OAUTH popup postMessage events to support elegant in-context integration
    const handleOAuthMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith(".run.app") && !origin.endsWith(".onrender.com") && !origin.includes("localhost") && !origin.includes("127.0.0.1")) {
        return;
      }
      
      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        setSuccessMsg("Connected! Choose any destination folder from your Google Drive inside the setup menu.");
        setShowAdminGuide(true);
        sessionStorage.removeItem("photo_deck_folder_clicked");
        setHasClickedFolder(false);
        fetchStatusAndPhotos();
      } else if (event.data?.type === "OAUTH_AUTH_ERROR") {
        setErrorMsg(event.data.msg || `Google Drive authentication failed: ${event.data.error}`);
      }
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => {
      window.removeEventListener("message", handleOAuthMessage);
    };
  }, []);

  // Sync folders list whenever setup drawer toggles open OR when folder is missing on active connection
  useEffect(() => {
    if (status?.connected && (showAdminGuide || !status?.folderId || status?.folderName === "App Uploads Gallery")) {
      fetchFoldersList();
    }
  }, [showAdminGuide, status?.connected, status?.folderId, status?.folderName]);

  const handleAdminAuthRedirect = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isInIframe = window.self !== window.top;

    let targetOrigin = window.location.origin;
    if (targetOrigin.includes("ais-dev-")) {
      targetOrigin = targetOrigin.replace("ais-dev-", "ais-pre-");
    }

    if (isInIframe) {
      // Always open in a popup window if inside an iframe since Google CSP blocks logins inside nested frames
      let authWindow: Window | null = null;
      try {
        authWindow = window.open("about:blank", "_blank");
        if (authWindow) {
          authWindow.document.write(`
            <html>
              <head>
                <title>Connecting...</title>
              </head>
              <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#1e293b;">
                <div style="text-align:center;padding:24px;">
                  <svg style="animation:spin 1s linear infinite;margin:0 auto 16px;height:32px;width:32px;color:#4f46e5;" viewBox="0 0 24 24" fill="none">
                    <circle style="opacity:0.15" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path style="opacity:0.85" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p style="font-size:15px;font-weight:600;margin:0 0 8px 0;color:#0f172a;">Connecting with Google Drive</p>
                  <p style="font-size:13px;color:#64748b;margin:0;">Please complete authorization in this window...</p>
                </div>
                <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
              </body>
            </html>
          `);
        }
      } catch (err) {
        console.error("Popup creation failed:", err);
      }

      try {
        const res = await fetch(`/api/auth/url?full=${useFullScope}&origin=${encodeURIComponent(targetOrigin)}`);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed setup");
        }
        const data = await res.json();
        
        if (authWindow && !authWindow.closed) {
          authWindow.location.href = data.url;
        } else {
          window.open(data.url, "_blank");
        }
      } catch (err: any) {
        if (authWindow) {
          try { authWindow.close(); } catch (e) {}
        }
        setErrorMsg(err.message || "Failed to trigger Google authentication process.");
      }
      return;
    }

    if (isMobile) {
      // Direct same-window redirect for standalone mobile web browsers to avoid popup blocker issues
      try {
        const res = await fetch(`/api/auth/url?full=${useFullScope}&origin=${encodeURIComponent(targetOrigin)}`);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed setup");
        }
        const data = await res.json();
        window.location.href = data.url;
      } catch (err: any) {
        setErrorMsg(err.message || "Failed to trigger Google authentication process.");
      }
      return;
    }

    // Standalone desktop popup flow
    let authWindow: Window | null = null;
    try {
      authWindow = window.open("about:blank", "_blank");
      if (authWindow) {
        authWindow.document.write(`
          <html>
            <head>
              <title>Connecting...</title>
            </head>
            <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#1e293b;">
              <div style="text-align:center;padding:24px;">
                <svg style="animation:spin 1s linear infinite;margin:0 auto 16px;height:32px;width:32px;color:#4f46e5;" viewBox="0 0 24 24" fill="none">
                  <circle style="opacity:0.15" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path style="opacity:0.85" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p style="font-size:15px;font-weight:600;margin:0 0 8px 0;color:#0f172a;">Connecting with Google Drive</p>
                <p style="font-size:13px;color:#64748b;margin:0;">Please complete authorization in this window...</p>
              </div>
              <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            </body>
          </html>
        `);
      }
    } catch (err) {
      console.error("Tab creation failed:", err);
    }

    try {
      const res = await fetch(`/api/auth/url?full=${useFullScope}&origin=${encodeURIComponent(targetOrigin)}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed setup");
      }
      const data = await res.json();
      
      if (authWindow && !authWindow.closed) {
        authWindow.location.href = data.url;
      } else {
        window.location.href = data.url;
      }
    } catch (err: any) {
      if (authWindow) {
        try { authWindow.close(); } catch (e) {}
      }
      setErrorMsg(err.message || "Failed to trigger Google authentication process.");
    }
  };

  const handleDisconnect = () => {
    setConfirmDialog({
      isOpen: true,
      title: "Disconnect Storage?",
      message: "Are you sure you want to disconnect your Google Drive storage? Disconnecting will prevent guests from viewing the gallery and uploading photos. This does not delete any of your files in Google Drive.",
      confirmText: "Disconnect",
      cancelText: "Keep Connected",
      isDestructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch("/api/disconnect", { method: "POST" });
          if (res.ok) {
            setSuccessMsg("Google Drive access has been disconnected.");
            setPhotos([]);
            setFolders([]);
            sessionStorage.removeItem("photo_deck_folder_clicked");
            setHasClickedFolder(false);
            fetchStatusAndPhotos();
          } else {
            setErrorMsg("Failed to disconnect service on server.");
          }
        } catch (err: any) {
          setErrorMsg("Failed to disconnect service.");
        }
      }
    });
  };

  const handleSelectFolder = async (folderId: string, folderName: string) => {
    if (isSandbox) {
      setSuccessMsg(`Succesfully linked gallery destination to "${folderName}".`);
      sessionStorage.setItem("photo_deck_folder_clicked", "true");
      setHasClickedFolder(true);
      setGuestFolderName(folderName);
      setStatus(prev => prev ? { ...prev, folderId, folderName } : null);
      return;
    }

    try {
      const res = await fetch("/api/folders/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, folderName }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Succesfully linked gallery destination to "${folderName}".`);
        sessionStorage.setItem("photo_deck_folder_clicked", "true");
        setHasClickedFolder(true);
        // Refresh status and photos instantly
        setLoadingPhotos(true);
        fetchStatusAndPhotos();
      } else {
        throw new Error(data.error || "Could not switch to folder.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to switch active folder.");
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);

    if (isSandbox) {
      const generatedId = `sandbox-${Date.now()}`;
      setSuccessMsg(`Successfully created and linked with "${newFolderName}"!`);
      setFolders(prev => [...prev, { id: generatedId, name: newFolderName }]);
      setStatus(prev => prev ? { ...prev, folderId: generatedId, folderName: newFolderName } : null);
      setNewFolderName("");
      sessionStorage.setItem("photo_deck_folder_clicked", "true");
      setHasClickedFolder(true);
      setCreatingFolder(false);
      return;
    }

    try {
      const res = await fetch("/api/folders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Successfully created and linked with "${data.folderName}"!`);
        setNewFolderName("");
        sessionStorage.setItem("photo_deck_folder_clicked", "true");
        setHasClickedFolder(true);
        setLoadingPhotos(true);
        fetchStatusAndPhotos();
        fetchFoldersList();
      } else {
        throw new Error(data.error || "Failed creating folder.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Could not create new Google Drive folder.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(Array.from(e.target.files));
    }
  };

  // Drag and drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const canUpload = (status?.connected && status?.folderId) || guestFolderId;
    if (canUpload && !uploading) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = document.documentElement.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const canUpload = (status?.connected && status?.folderId) || guestFolderId;
    if (canUpload && !uploading && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(Array.from(e.dataTransfer.files));
    }
  };

  useEffect(() => {
    window.addEventListener("dragover", handleDragOver as any);
    window.addEventListener("dragleave", handleDragLeave as any);
    window.addEventListener("drop", handleDrop as any);
    return () => {
      window.removeEventListener("dragover", handleDragOver as any);
      window.removeEventListener("dragleave", handleDragLeave as any);
      window.removeEventListener("drop", handleDrop as any);
    };
  }, [status, uploading, guestFolderId]);

  const uploadFiles = async (files: File[]) => {
    const validFiles = files.filter(file => {
      if (!file.type.startsWith("image/")) {
        setErrorMsg(`Skipped "${file.name}": Must be an image file.`);
        return false;
      }
      if (file.size > 15 * 1024 * 1024) {
        setErrorMsg(`Skipped "${file.name}": Files must be under 15MB.`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    setUploading(true);
    setErrorMsg(null);
    setUploadProgress(5);

    if (isSandbox) {
      let uploadedCount = 0;
      await new Promise(resolve => setTimeout(resolve, 800)); // Mimic networking latency
      
      const newSimulatedPhotos: Photo[] = [];
      const currentStored = JSON.parse(localStorage.getItem("sandbox_photos") || "null") || DEMO_PHOTOS;
      
      for (const file of validFiles) {
        const objectUrl = URL.createObjectURL(file);
        const newPhoto: Photo = {
          id: objectUrl,
          name: file.name,
          mimeType: file.type,
          createdTime: new Date().toISOString(),
          size: String(file.size)
        };
        newSimulatedPhotos.push(newPhoto);
        
        setMyUploads((prev) => {
          const updated = [...prev, objectUrl];
          localStorage.setItem("public_drive_gallery_uploads", JSON.stringify(updated));
          return updated;
        });
        uploadedCount++;
      }
      
      const updatedPhotos = [...newSimulatedPhotos, ...currentStored];
      setPhotos(updatedPhotos);
      localStorage.setItem("sandbox_photos", JSON.stringify(updatedPhotos));
      
      setSuccessMsg(`Successfully uploaded ${uploadedCount} photo${uploadedCount > 1 ? "s" : ""} to your sandbox gallery!`);
      setUploadProgress(100);
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
      }, 650);
      return;
    }

    let uploadedCount = 0;
    const total = validFiles.length;

    for (let i = 0; i < total; i++) {
      const file = validFiles[i];
      const percentDoneBefore = Math.round((i / total) * 100);
      setUploadProgress(percentDoneBefore || 5);
      setSuccessMsg(`Uploading "${file.name}" (${i + 1} of ${total})...`);

      const formData = new FormData();
      formData.append("photo", file);
      if (guestFolderId) {
        formData.append("folderId", guestFolderId);
      }

      try {
        const uploadUrl = guestFolderId ? `/api/upload?folderId=${guestFolderId}` : "/api/upload";
        const res = await fetch(uploadUrl, {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Upload failed for "${file.name}"`);
        }

        const newUploadId = data.fileId;
        setMyUploads((prev) => {
          const updated = [...prev, newUploadId];
          localStorage.setItem("public_drive_gallery_uploads", JSON.stringify(updated));
          return updated;
        });

        uploadedCount++;
      } catch (err: any) {
        console.error("Batch element upload failed:", err);
        setErrorMsg(err.message || "Failed to upload file.");
      }
    }

    setUploadProgress(100);
    if (uploadedCount > 0) {
      setSuccessMsg(`Successfully uploaded ${uploadedCount} photo${uploadedCount > 1 ? "s" : ""}!`);
    }

    // Refresh photos list
    try {
      const reloadUrl = guestFolderId ? `/api/photos?folderId=${guestFolderId}` : "/api/photos";
      const photoRes = await fetch(reloadUrl);
      if (photoRes.ok) {
        const photoData = await photoRes.json();
        setPhotos(photoData.photos || []);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
      }, 600);
    }
  };

  const downloadSelectedPhotosAsZip = async (photosToDownload: Photo[]) => {
    if (photosToDownload.length === 0) return;

    setBatchActionLoading(true);
    setBatchActionLabel("ZIP Compressing...");
    setBatchActionProgress(10);
    setErrorMsg(null);

    try {
      const zip = new JSZip();
      const total = photosToDownload.length;

      for (let i = 0; i < total; i++) {
        const photo = photosToDownload[i];
        setBatchActionLabel(`Archiving "${photo.name}" (${i + 1}/${total})`);
        setBatchActionProgress(Math.round(10 + (i / total) * 75));

        const res = await fetch(`/api/photos/view/${photo.id}`);
        if (!res.ok) throw new Error(`Could not download image: ${photo.name}`);
        const blob = await res.blob();

        let fileName = photo.name;
        // Fix up raw names without extension
        if (!fileName.includes(".")) {
          const extension = blob.type.split("/")[1] || "jpg";
          fileName = `${fileName}.${extension}`;
        }

        zip.file(fileName, blob);
      }

      setBatchActionLabel("Generating download package...");
      setBatchActionProgress(90);

      const content = await zip.generateAsync({ type: "blob" });
      setBatchActionProgress(98);

      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = guestFolderId 
        ? `${guestFolderName || "Shared_Gallery"}_photos.zip` 
        : `${status?.folderName || "PhotoDock"}_photos.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSuccessMsg(`Successfully compressed and downloaded ${total} photo${total > 1 ? "s" : ""}!`);
    } catch (err: any) {
      console.error("ZIP Generation error:", err);
      setErrorMsg(`Failed to bundle images into ZIP: ${err.message}`);
    } finally {
      setBatchActionLoading(false);
      setBatchActionProgress(0);
      setBatchActionLabel("");
    }
  };

  const shareSelectedPhotosToPhone = async (selectedPhotos: Photo[]) => {
    if (selectedPhotos.length === 0) return;

    setBatchActionLoading(true);
    setBatchActionLabel("Preparing phone share sheet...");
    setBatchActionProgress(10);
    setErrorMsg(null);

    try {
      const filesList: File[] = [];
      const total = selectedPhotos.length;

      for (let i = 0; i < total; i++) {
        const photo = selectedPhotos[i];
        setBatchActionLabel(`Fetching "${photo.name}" (${i + 1}/${total})`);
        setBatchActionProgress(Math.round(10 + (i / total) * 50));

        const response = await fetch(`/api/photos/view/${photo.id}`);
        if (!response.ok) throw new Error(`Failed to load picture item: ${photo.name}`);
        const blob = await response.blob();

        const mimeType = photo.mimeType || blob.type || "image/jpeg";
        let fileName = photo.name;
        if (!fileName.includes(".")) {
          const ext = mimeType.split("/")[1] || "jpg";
          fileName = `${fileName}.${ext}`;
        }

        const file = new File([blob], fileName, { type: mimeType });
        filesList.push(file);
      }

      setBatchActionProgress(75);
      setBatchActionLabel("Opening native phone share dialog...");

      if (navigator.canShare && navigator.canShare({ files: filesList })) {
        setBatchActionProgress(90);
        await navigator.share({
          files: filesList,
          title: "Save Photos to Camera Roll",
          text: 'Select options like "Save Images" or share directly inside native Photos/Camera Roll.'
        });
        setSuccessMsg(`Save request completed!`);
      } else {
        throw new Error("Local device browser restricts sharing multiple file links. Falling back to downloading as ZIP archive.");
      }
    } catch (err: any) {
      console.warn("Native phone share sheet was not opened or supported:", err);
      // Fallback: trigger JSZip download!
      setSuccessMsg("Save dialog unavailable or closed. Converting selection to dynamic ZIP folder...");
      await downloadSelectedPhotosAsZip(selectedPhotos);
    } finally {
      setBatchActionLoading(false);
      setBatchActionProgress(0);
      setBatchActionLabel("");
    }
  };

  const handleTrashMultiplePhotos = (photoIds: string[]) => {
    setConfirmDialog({
      isOpen: true,
      title: `Delete ${photoIds.length} Selected Photo${photoIds.length > 1 ? "s" : ""}?`,
      message: `Are you sure you want to delete the ${photoIds.length} selected photo${photoIds.length > 1 ? "s" : ""}? This sends them directly to the storage owner's Google Drive trash folder.`,
      confirmText: "Yes, Delete",
      cancelText: "Cancel",
      isDestructive: true,
      onConfirm: async () => {
        if (isSandbox) {
          setPhotos((prev) => prev.filter((p) => !photoIds.includes(p.id)));
          const updatedUploads = myUploads.filter((id) => !photoIds.includes(id));
          setMyUploads(updatedUploads);
          localStorage.setItem("public_drive_gallery_uploads", JSON.stringify(updatedUploads));
          const currentPhotos = JSON.parse(localStorage.getItem("sandbox_photos") || "null") || [];
          const updatedStored = currentPhotos.filter((p: any) => !photoIds.includes(p.id));
          localStorage.setItem("sandbox_photos", JSON.stringify(updatedStored));
          setSelectedPhotoIds([]);
          setIsSelecting(false);
          setSuccessMsg(`Successfully deleted ${photoIds.length} photo${photoIds.length > 1 ? "s" : ""} from sandbox.`);
          return;
        }

        setBatchActionLoading(true);
        setBatchActionLabel("Deleting elements from Drive...");
        setBatchActionProgress(10);

        let deletedCount = 0;
        const total = photoIds.length;

        for (let i = 0; i < total; i++) {
          const id = photoIds[i];
          setBatchActionProgress(Math.round(10 + (i / total) * 80));
          try {
            const res = await fetch(`/api/delete/${id}`, { method: "POST" });
            if (res.ok) {
              deletedCount++;
            }
          } catch (err) {
            console.error(`Failed to delete individual photo: ${id}`, err);
          }
        }

        setPhotos((prev) => prev.filter((p) => !photoIds.includes(p.id)));

        const updatedUploads = myUploads.filter((id) => !photoIds.includes(id));
        setMyUploads(updatedUploads);
        localStorage.setItem("public_drive_gallery_uploads", JSON.stringify(updatedUploads));

        setSelectedPhotoIds([]);
        setIsSelecting(false);

        setBatchActionLoading(false);
        setBatchActionProgress(0);
        setBatchActionLabel("");

        if (deletedCount > 0) {
          setSuccessMsg(`Successfully trashed ${deletedCount} photo${deletedCount > 1 ? "s" : ""}.`);
        } else {
          setErrorMsg("None of the selected photos could be deleted.");
        }
      }
    });
  };

  const handleTrashPhoto = (photoId: string, photoName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete Photo?",
      message: `Are you sure you want to permanently delete "${photoName}" from Google Drive? This will move it to your Google Drive trash folder.`,
      confirmText: "Delete",
      cancelText: "Keep Photo",
      isDestructive: true,
      onConfirm: async () => {
        if (isSandbox) {
          setPhotos((prev) => prev.filter((p) => p.id !== photoId));
          const updatedUploads = myUploads.filter((id) => id !== photoId);
          setMyUploads(updatedUploads);
          localStorage.setItem("public_drive_gallery_uploads", JSON.stringify(updatedUploads));
          const currentPhotos = JSON.parse(localStorage.getItem("sandbox_photos") || "null") || [];
          const updatedStored = currentPhotos.filter((p: any) => p.id !== photoId);
          localStorage.setItem("sandbox_photos", JSON.stringify(updatedStored));
          setSuccessMsg("Photo successfully deleted from sandbox.");
          if (selectedPhoto?.id === photoId) {
            setSelectedPhoto(null);
          }
          return;
        }

        try {
          const res = await fetch(`/api/delete/${photoId}`, { method: "POST" });
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || "Failed to trash file.");
          }

          setPhotos((prev) => prev.filter((p) => p.id !== photoId));
          
          const updatedUploads = myUploads.filter((id) => id !== photoId);
          setMyUploads(updatedUploads);
          localStorage.setItem("public_drive_gallery_uploads", JSON.stringify(updatedUploads));

          setSuccessMsg("Photo successfully junked.");
          if (selectedPhoto?.id === photoId) {
            setSelectedPhoto(null);
          }
        } catch (err: any) {
          setErrorMsg(err.message || "Failed to trash image.");
        }
      }
    });
  };

  const formatFileSize = (bytes?: string) => {
    if (!bytes) return "";
    const b = parseInt(bytes, 10);
    if (isNaN(b)) return "";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getPublicRedirectUri = () => {
    return `${window.location.origin}/api/oauth/callback`;
  };

  // Switch photos in lightbox (Left/Right swipe browsing)
  const navigateLightbox = (direction: "prev" | "next") => {
    if (!selectedPhoto) return;
    const currentIndex = filteredPhotos.findIndex(p => p.id === selectedPhoto.id);
    if (currentIndex === -1) return;

    let targetIndex = currentIndex;
    if (direction === "prev") {
      targetIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : filteredPhotos.length - 1;
    } else {
      targetIndex = currentIndex + 1 < filteredPhotos.length ? currentIndex + 1 : 0;
    }
    setSelectedPhoto(filteredPhotos[targetIndex]);
  };

  // Keyboard navigation for Lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedPhoto) return;
      if (e.key === "ArrowLeft") navigateLightbox("prev");
      if (e.key === "ArrowRight") navigateLightbox("next");
      if (e.key === "Escape") setSelectedPhoto(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPhoto, photos, filterType, searchQuery, sortBy]);

  // Escape key handler for Presenter Screen Cast mode
  useEffect(() => {
    const handleCastKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowCastMode(false);
      }
    };
    if (showCastMode) {
      window.addEventListener("keydown", handleCastKeyDown);
    }
    return () => window.removeEventListener("keydown", handleCastKeyDown);
  }, [showCastMode]);

  // Filtering & Sorting Process
  const filteredPhotos = photos
    .filter((photo) => {
      // 1. Search Query
      if (searchQuery.trim() !== "") {
        return photo.name.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    })
    .filter((photo) => {
      // 2. Tab Filter type
      if (filterType === "mine") {
        return myUploads.includes(photo.id);
      }
      if (filterType === "recent") {
        // Created in the last 24 hours
        const createdTime = new Date(photo.createdTime).getTime();
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        return createdTime > oneDayAgo;
      }
      return true;
    })
    .sort((a, b) => {
      // 3. Sorting
      if (sortBy === "date_desc") {
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
      }
      if (sortBy === "date_asc") {
        return new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime();
      }
      if (sortBy === "name_asc") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "size_desc") {
        const sizeA = a.size ? parseInt(a.size, 10) : 0;
        const sizeB = b.size ? parseInt(b.size, 10) : 0;
        return sizeB - sizeA;
      }
      return 0;
    });

  // Calculate stats
  const totalPhotosSize = photos.reduce((acc, current) => {
    if (!current.size) return acc;
    const num = parseInt(current.size, 10);
    return isNaN(num) ? acc : acc + num;
  }, 0);



  const getGridColsClass = () => {
    if (columnsCount === 2) return "grid-cols-2";
    if (columnsCount === 3) return "grid-cols-2 sm:grid-cols-3";
    if (columnsCount === 4) return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
    if (columnsCount === 5) return "grid-cols-3 sm:grid-cols-4 md:grid-cols-5";
    return "grid-cols-3 sm:grid-cols-4 md:grid-cols-6";
  };

  const renderInstructionsPlaybook = () => (
    <div className="border border-indigo-150 dark:border-indigo-950/60 rounded-[28px] p-6 bg-linear-to-br from-indigo-50/10 via-slate-50/20 to-white dark:from-slate-900/40 dark:via-slate-850/20 dark:to-slate-900 space-y-5 shadow-3xs" id="app_instructions_guide_box">
      <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div className="p-1.5 bg-indigo-50/80 dark:bg-indigo-950/50 rounded-xl text-indigo-600 dark:text-indigo-400">
          <CheckCircle className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
            How PhotoDock Works! 📸✨
          </h4>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono tracking-wider uppercase mt-0.5">Four super simple steps to build your live photo sharing gallery</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {/* Step 1 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:border-indigo-105 dark:hover:border-indigo-950 hover:shadow-2xs rounded-2xl p-4 space-y-2 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50/85 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md font-mono">STEP 1</span>
            <Lock className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          </div>
          <div className="space-y-1">
            <h5 className="text-[12.5px] font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">🔌 Link Your Drive</h5>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed md:leading-normal">
              Click the button to connect your Google Drive. This acts like placing a safe, private lockbox for all your party snaps.
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:border-indigo-105 dark:hover:border-indigo-950 hover:shadow-2xs rounded-2xl p-4 space-y-2 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50/85 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md font-mono">STEP 2</span>
            <Grid className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          </div>
          <div className="space-y-1">
            <h5 className="text-[12.5px] font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">📂 Pick an Album</h5>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed md:leading-normal">
              Pick a folder or write any name to make a brand-new one. Think of it like a beautiful photo album waiting for fun memories.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:border-indigo-105 dark:hover:border-indigo-950 hover:shadow-2xs rounded-2xl p-4 space-y-2 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50/85 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md font-mono">STEP 3</span>
            <QrCode className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          </div>
          <div className="space-y-1">
            <h5 className="text-[12.5px] font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">📱 Share QR or Link</h5>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed md:leading-normal">
              Copy your private link or show friends the QR code. You can even project it onto a TV screen at the party!
            </p>
          </div>
        </div>

        {/* Step 4 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 hover:border-indigo-105 dark:hover:border-indigo-950 hover:shadow-2xs rounded-2xl p-4 space-y-2 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50/85 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md font-mono">STEP 4</span>
            <Upload className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          </div>
          <div className="space-y-1">
            <h5 className="text-[12.5px] font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">🎈 Drag, Drop & See!</h5>
            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed md:leading-normal">
              Anyone can drop photos from their phone or computer with zero logins! Photos instantly show up live in the gallery interface.
            </p>
          </div>
        </div>
      </div>

      <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
        <span>✨ Pro Tip: Share the link or QR with party guests so they can upload directly from their phones!</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b0f19] text-slate-950 dark:text-slate-100 font-sans antialiased selection:bg-slate-900 dark:selection:bg-indigo-600 selection:text-white transition-colors duration-200" id="main_app_layout">
      
      {/* GLOBAL DRAG AND DROP OVERLAY - APPLE HIGHLIGHT */}
      <AnimatePresence>
        {dragActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-[6px] border-slate-950/10 dark:border-white/10 m-4 rounded-[32px] pointer-events-none"
            id="drag_overlay"
          >
            <div className="bg-slate-950 dark:bg-slate-100 text-white dark:text-slate-950 p-6 rounded-3xl shadow-xl flex items-center justify-center mb-4">
              <Upload className="h-8 w-8 animate-bounce" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white font-sans">Drop to Fly Upload</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Directly routes into active Drive Folder: "{guestFolderId ? (guestFolderName || "Shared Gallery") : (status?.folderName === "App Uploads Gallery" ? "Folders" : (status?.folderName || "Folders"))}"
            </p>
          </motion.div>
        )}
      </AnimatePresence>



      {/* APPLE NAVIGATION HEADER/BAR */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-[#0b0f19]/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-900/60 flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 gap-2.5 transition-colors duration-200" id="app_header">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-full bg-slate-950 dark:bg-slate-100 flex items-center justify-center text-white dark:text-slate-950 shrink-0" id="app_badge_icon">
            <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-none truncate">
              {guestFolderId ? "PhotoDrop Shared" : "PhotoDock"}
            </h1>
            <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 font-medium font-mono uppercase mt-0.5 truncate" id="header_sync_text">
              {guestFolderId ? (
                <>
                  <span className="hidden sm:inline">SECURE </span>GUEST ACCESS
                </>
              ) : (
                <>
                  <span className="hidden sm:inline">ANONYMOUS </span>STORAGE PORT
                </>
              )}
            </p>
          </div>
        </div>

        {/* Action controllers */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

          {guestFolderId ? (
            <div className="flex items-center gap-1.5 shadow-3xs shrink-0">
              <span className="hidden xs:flex text-[11px] font-semibold text-slate-800 dark:text-slate-250 bg-slate-100 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 px-3 py-1 rounded-full flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500"></span>
                Shared Gallery
              </span>
            </div>
          ) : (
            <>
              {status?.connected && status?.folderId && (
                <div className="hidden lg:flex items-center gap-2 mr-1">
                  <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md max-w-[190px] truncate" title={status.folderName || ""}>
                    Destination: <span className="text-slate-950 font-bold">{status.folderName}</span>
                  </span>
                </div>
              )}

              <div className="flex items-center gap-1.5 sm:gap-2">
                {!status?.connected && (
                   <button
                    onClick={handleAdminAuthRedirect}
                    className="text-[10.5px] sm:text-[11.5px] font-bold px-3 py-1 text-white inline-flex items-center gap-0.5 transition-all rounded-full bg-indigo-600 hover:bg-indigo-700 cursor-pointer shadow-3xs"
                    id="connect_drive_header_button"
                  >
                    <span>Connect Drive</span>
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  </button>
                )}

                {status?.connected && (
                  <span className="text-[10.5px] sm:text-[11px] font-semibold text-emerald-850 dark:text-emerald-450 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100/60 dark:border-emerald-900 px-2 sm:px-3 py-1 rounded-full flex items-center gap-1 sm:gap-1.5 shadow-3xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span><span className="hidden xs:inline">Drive </span>Connected</span>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* GUEST BANNER AND NOTIFICATION MESSAGES */}
      <div className="max-w-6xl mx-auto px-6 pt-6">
        <AnimatePresence>
          {/* Iframe top notice banner removed */}



          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-900 text-xs mb-4"
              id="global_error_box"
            >
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold">Error Encountered</span>
                <p className="text-red-700 mt-0.5 leading-relaxed">{errorMsg}</p>
              </div>
              <button onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-800 transition-colors font-bold ml-1">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}

          {successMsg && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3 text-emerald-900 text-xs mb-4"
              id="global_success_box"
            >
              <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold">Success</span>
                <p className="text-emerald-700 mt-0.5  leading-relaxed">{successMsg}</p>
              </div>
              <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-800 transition-colors font-bold ml-1">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* COLLAPSIBLE DRIVE AND FOLDERS SECTOR - CHOOSE WHICH FOLDER */}
      <AnimatePresence>
        {!guestFolderId && status?.connected && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden max-w-6xl mx-auto px-6 mb-6"
            id="collapsible_admin_drawer"
          >
            <div className="bg-white border border-slate-200/80 rounded-[32px] p-6 shadow-xs space-y-6">
              
              {/* Header inside drawer */}
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <FolderOpen className="h-4.5 w-4.5 text-slate-800" />
                    Storage Connection Panel
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 font-sans">Pick which directory your guests' uploaded photos will be saved to.</p>
                </div>
              </div>

              {/* Status and Authenticate option */}
              <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-900 font-mono tracking-wider uppercase text-[10px] text-slate-400">ACTIVE STORAGE CONNECTION</p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Connected to Google Drive account <span className="font-bold text-slate-800 underline decoration-indigo-400">{status?.ownerEmail || "Somuchfood789@gmail.com"}</span>. Photos are saved instantly into the designated folder chosen below.
                  </p>
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={handleDisconnect}
                    className="text-xs font-bold text-red-650 bg-red-50 hover:bg-red-100 border border-red-150 px-5 py-2.5 rounded-full transition-all flex items-center gap-1.5"
                    id="disconnect_account_button"
                  >
                    <span>Disconnect Google Drive</span>
                  </button>
                </div>
              </div>

              {/* Google Drive Storage details & warnings */}
              {status?.connected && status?.storageQuota && (
                <div className="border border-slate-100 rounded-2xl p-5 bg-white dark:bg-slate-900/40 shadow-3xs space-y-4" id="google_drive_storage_details">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg ${status.storageQuota.isNearingLimit ? "bg-amber-50 text-amber-600 dark:bg-amber-950/20 dark:text-amber-400" : "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/20 dark:text-indigo-400"}`}>
                        <HardDrive className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          Google Drive Storage Quota
                        </h4>
                        <p className="text-xs text-slate-400 font-sans mt-0.5">
                          {status.storageQuota.percentageUsed}% of storage used
                        </p>
                      </div>
                    </div>
                    {status.storageQuota.isNearingLimit && (
                      <span className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 shadow-4xs animate-pulse dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Storage Nearing Limit
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${status.storageQuota.isNearingLimit ? "bg-amber-500" : "bg-indigo-500"}`}
                        style={{ width: `${Math.min(status.storageQuota.percentageUsed, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs font-mono text-slate-500">
                      <span>{formatBytes(status.storageQuota.usage)} used</span>
                      <span>Total Quota: {formatBytes(status.storageQuota.limit)}</span>
                    </div>
                  </div>

                  {status.storageQuota.isNearingLimit && (
                    <div className="bg-amber-50/65 dark:bg-amber-950/10 border border-amber-150/70 dark:border-amber-900/30 p-3.5 rounded-xl text-xs text-amber-800 dark:text-amber-400 leading-relaxed font-sans">
                      <p className="font-semibold flex items-center gap-1">
                        <span>⚠️ Drive space is extremely low!</span>
                      </p>
                      <p className="mt-1">
                        Ensure you delete old files, empty your Google Drive Trash, or upgrade your Google Workspace/Google One quota. Uploads will fail to process once your account limit is fully exhausted.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ACTIVE FOLDER PICKER - CRITICAL USER REQUEST */}
              {status?.connected && (
                <div className="grid md:grid-cols-2 gap-6 pt-4 border-t border-slate-100" id="folders_picker_container">
                  
                  {/* Column 1: Pick an existing folder */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Grid className="h-3.5 w-3.5 text-slate-600" />
                        Choose active Google Drive folder:
                      </label>
                      <button 
                        onClick={fetchFoldersList} 
                        className="text-[10px] font-bold text-slate-500 hover:text-slate-950 flex items-center gap-1"
                        disabled={loadingFolders}
                      >
                        <RefreshCw className={`h-3 w-3 ${loadingFolders ? "animate-spin" : ""}`} />
                        <span>Rescan Drive</span>
                      </button>
                    </div>

                    {loadingFolders ? (
                      <div className="p-10 border border-slate-100 rounded-2xl flex flex-col items-center justify-center gap-2 bg-slate-50/20">
                        <RefreshCw className="h-4 w-4 text-slate-400 animate-spin" />
                        <span className="text-[10px] text-slate-400 font-mono">RETRIEVING FOLDER ENTRIES</span>
                      </div>
                    ) : folders.length === 0 ? (
                      <div className="p-6 border border-slate-200 border-dashed rounded-2xl text-center bg-slate-50/50">
                        <p className="text-xs text-slate-450">No folders detected in your Drive. Create one using the form on the right!</p>
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-2xl p-2.5 space-y-1.5 bg-slate-50/30 scrollbar-thin scrollbar-thumb-slate-200">
                        {folders.map((fold) => {
                          if (fold.name === "App Uploads Gallery") {
                            return (
                              <div
                                key={fold.id}
                                className="w-full text-left p-3 rounded-xl bg-slate-100/50 dark:bg-slate-900/50 text-slate-455 dark:text-slate-500 border border-slate-100 dark:border-slate-800 flex items-center justify-between cursor-not-allowed opacity-65"
                                title="App default folder"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <FolderOpen className="h-4 w-4 text-slate-400" />
                                  <span className="text-xs font-semibold truncate">Folders</span>
                                </div>
                                <span className="text-[9px] font-mono select-none px-2 py-0.5 bg-slate-200/50 dark:bg-slate-800 rounded">Default</span>
                              </div>
                            );
                          }
                          const isActive = fold.id === status.folderId;
                          return (
                            <button
                              key={fold.id}
                              onClick={() => handleSelectFolder(fold.id, fold.name)}
                              className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between group ${
                                isActive 
                                  ? "bg-slate-950 text-white shadow-xs" 
                                  : "hover:bg-slate-150 text-slate-700 hover:text-slate-950 bg-white border border-slate-100"
                              }`}
                              title={fold.name}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <FolderOpen className={`h-4 w-4 ${isActive ? "text-slate-200" : "text-amber-500"}`} />
                                <span className="text-xs font-semibold truncate">{fold.name}</span>
                              </div>
                              {isActive ? (
                                <Check className="h-4 w-4 text-white shrink-0" />
                              ) : (
                                <span className="text-[10px] font-mono text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">Select</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Column 2: Create a brand new folder */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <FolderPlus className="h-3.5 w-3.5 text-slate-600" />
                      Create a new custom folder:
                    </label>

                    <form onSubmit={handleCreateFolder} className="space-y-3">
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Enter your custom folder name. We will create it inside Google Drive instantly and route all uploads dynamically to this new location.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="e.g. Wedding Photo Drop, Vacation"
                            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-950 focus:outline-none focus:border-slate-800 flex-1"
                            disabled={creatingFolder}
                          />
                          <button
                            type="submit"
                            disabled={creatingFolder || !newFolderName.trim()}
                            className="bg-slate-950 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 shrink-0"
                          >
                            {creatingFolder ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <span>Create & Bind</span>
                            )}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>

                </div>
              )}

              {/* Technical guidelines link */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono">Google Auth scopes: drive.file, drive (read/write)</span>
                <span>Active Linkage Identifier: {status?.ownerEmail || "Somuchfood789@gmail.com"}</span>
              </div>

            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* APPLE PHOTOS INSTANT LAYOUT AND NAVIGATION */}
      <main className="max-w-6xl mx-auto px-6 pb-24" id="main_gallery_wrapper">
        
        {/* Title & Core Apple Photo Navigation segment tabs */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 py-6" id="photo_controls_dashboard">
          <div className="space-y-1.5 flex-1 min-w-0">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              {guestFolderId ? (guestFolderName || "Shared Gallery") : "Photos"}
            </h2>
            
            {/* Folder indicator subtext */}
            {guestFolderId ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 font-mono break-words">
                visitor drop zone &bull; storing safely to Google Drive ({photos.length} elements detected)
              </p>
            ) : status?.connected && status?.folderId ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 font-mono flex flex-wrap items-center gap-1 break-words">
                active storage node &bull; <span className="font-bold text-slate-600 dark:text-slate-300 underline">{status.folderName}</span> ({photos.length} elements detected)
              </p>
            ) : status?.connected ? (
              <p className="text-xs text-amber-600 dark:text-amber-500 font-bold font-mono break-words">
                pre-activation mode &bull; choice of landing directory pending
              </p>
            ) : null}

                       {/* Premium Share Link Box for Connected Owners */}
            {status?.connected && status?.folderId && hasClickedFolder && !guestFolderId && status?.folderName !== "App Uploads Gallery" && (
              <div 
                className="mt-6 overflow-hidden rounded-3xl border border-indigo-150 dark:border-indigo-950 bg-linear-to-br from-white via-indigo-50/15 to-purple-50/25 dark:from-slate-900 dark:via-indigo-950/5 dark:to-purple-950/5 p-5 md:p-6 shadow-xs max-w-3xl" 
                id="owner_guest_share_card"
              >
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-stretch">
                  
                  {/* Left Column: Portal Status, Link copy, and interactive buttons */}
                  <div className="flex-1 space-y-4 min-w-0">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-450 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 font-mono tracking-widest uppercase">
                          Live Capture Pipeline Established
                        </span>
                      </div>
                      <h4 className="text-base font-extrabold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                        <QrCode className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
                        Guest Upload & Gallery Portal
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-md">
                        Guests can view previous snaps and drop pictures instantly. <strong className="text-slate-800 dark:text-slate-200">No account or sign-in required!</strong> Files feed straight to your Google Drive folder: <span className="underline font-semibold text-slate-700 dark:text-slate-300">"{status.folderName}"</span>.
                      </p>
                    </div>

                    {/* Styled Link Copy input section */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">Your Share Link</span>
                      <div className="flex gap-2 items-center max-w-md w-full">
                        <div className="relative flex-1 min-w-0">
                          <input
                            type="text"
                            readOnly
                            value={getPublicGuestUrl(status.folderId!)}
                            className="bg-slate-50 dark:bg-slate-950 dark:text-slate-350 hover:bg-slate-100/50 dark:hover:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl pl-3 pr-8 py-2 text-xs text-slate-600 w-full focus:outline-none font-mono truncate transition-all shadow-4xs"
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <span className="absolute right-2.5 top-2.5 text-[9px] text-slate-400 dark:text-slate-500 font-mono select-none">GUEST</span>
                        </div>
                        <button
                          onClick={() => handleCopyShareLink(status.folderId!)}
                          className="bg-indigo-600 hover:bg-indigo-750 text-white font-extrabold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 hover:scale-[1.02] active:scale-95 shrink-0 cursor-pointer shadow-xs shadow-indigo-120 dark:shadow-none"
                        >
                          {copiedShareLink ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Check className="h-3.5 w-3.5 shrink-0" />
                              <span>Copy URL</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Distinctive Custom Action Buttons */}
                    <div className="flex flex-wrap gap-2.5 pt-1">
                      <button
                        onClick={handleDownloadQR}
                        className="bg-slate-900 dark:bg-slate-100 hover:bg-slate-850 dark:hover:bg-white/90 text-white dark:text-slate-900 rounded-xl px-4 py-2 text-xs font-bold transition-all inline-flex items-center gap-2 cursor-pointer shadow-xs active:scale-98"
                      >
                        <Download className="h-3.5 w-3.5 text-slate-300 dark:text-slate-700" />
                        <span>Download QR Poster (PNG)</span>
                      </button>
                    </div>

                  </div>

                  {/* Right Column: Custom Stylized High-contrast QR visual block with corner patterns */}
                  <div className="w-full md:w-auto flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900/60 border border-slate-150 dark:border-slate-800 rounded-2xl p-4.5 shrink-0 min-w-[155px] self-stretch gap-2.5 shadow-4xs" id="owner_guest_share_qr">
                    <div className="bg-white p-3 rounded-xl border border-slate-200/60 flex items-center justify-center shadow-md relative group">
                      <QRCodeSVG 
                        value={getPublicGuestUrl(status.folderId!)}
                        size={100}
                        level="H"
                        includeMargin={false}
                        fgColor="#1e1b4b" // Deep beautiful Indigo Instead of harsh absolute black
                      />
                      {/* Stylized camera lens center overlay design made purely from css overlay */}
                      <div className="absolute inset-0 m-auto h-6 w-6 rounded-full bg-indigo-50 border-2 border-indigo-200 flex items-center justify-center opacity-90 shadow-4xs">
                        <ImageIcon className="h-3 w-3 text-indigo-600" />
                      </div>
                    </div>
                    <div className="text-center">
                      <span className="text-[9px] font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest font-sans block">
                        Scan to Join
                      </span>
                      <span className="text-[8px] text-slate-400 dark:text-slate-500 font-mono block mt-0.5">
                        OR TAP COPY LINK
                      </span>
                    </div>
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* Tab Selector iPhone Photos Style: library, my uploads, recent */}
          <div className="flex flex-wrap items-center gap-2 xs:gap-3" id="ios_style_tab_filter_and_select">
            <div className="flex bg-slate-100 dark:bg-slate-900 p-0.5 xs:p-1 rounded-full text-[11px] xs:text-xs font-bold transition-colors">
              <button
                onClick={() => setFilterType("all")}
                aria-label="Filter: View all photos"
                className={`px-2.5 xs:px-4 py-1 rounded-full transition-all cursor-pointer ${
                  filterType === "all" ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs" : "text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"
                }`}
              >
                All Photos
              </button>
              <button
                onClick={() => setFilterType("mine")}
                aria-label="Filter: View my drops only"
                className={`px-2.5 xs:px-4 py-1 rounded-full transition-all cursor-pointer ${
                  filterType === "mine" ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs" : "text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"
                }`}
              >
                My Drops
              </button>
              <button
                onClick={() => setFilterType("recent")}
                aria-label="Filter: View recent past 24 hours drops"
                className={`px-2.5 xs:px-4 py-1 rounded-full transition-all cursor-pointer ${
                  filterType === "recent" ? "bg-white dark:bg-slate-800 text-slate-950 dark:text-white shadow-xs" : "text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"
                }`}
              >
                Past 24h
              </button>
            </div>

            {/* iOS "Select" Button */}
            {((status?.connected && status?.folderId) || guestFolderId) && photos.length > 0 && (
              <button
                onClick={() => {
                  if (isSelecting) {
                    setIsSelecting(false);
                    setSelectedPhotoIds([]);
                  } else {
                    setIsSelecting(true);
                  }
                }}
                className={`px-3 xs:px-4 py-1.5 xs:py-2 rounded-full text-[11px] xs:text-xs font-bold select-none cursor-pointer border transition-all hover:scale-[1.02] active:scale-[0.98] ${
                  isSelecting 
                    ? "bg-slate-950 dark:bg-slate-100 border-slate-950 dark:border-white text-white dark:text-slate-950 shadow-xs" 
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-850 hover:text-slate-950 dark:hover:text-white"
                }`}
                title="Toggle photo selection mode"
              >
                {isSelecting ? "Cancel" : "Select"}
              </button>
            )}
          </div>
        </div>

        {/* CONTROLS BAR: SEARCH, SORTER, GRID SCALE SLIDER */}
        {((status?.connected && status?.folderId) || guestFolderId) && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-4 mb-8 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 shadow-3xs transition-colors" id="controls_action_bar">
            
            {/* 1. iOS Search input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search photo titles..."
                className="w-full bg-slate-100 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 hover:border-slate-200 dark:hover:border-slate-700/80 focus:bg-white dark:focus:bg-slate-950 rounded-xl pl-10 pr-9 py-2 text-xs font-semibold focus:outline-none focus:border-slate-800 dark:focus:border-indigo-500/80 text-slate-950 dark:text-slate-100 transition-all placeholder-slate-400 dark:placeholder-slate-500"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-550 hover:text-slate-900 dark:hover:text-white text-xs font-bold"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* 2. Premium Grid Size Zoom and Sorters */}
            <div className="flex flex-wrap items-center gap-2 xs:gap-3 sm:gap-4 text-xs font-bold">
              
              {/* Columns Slider Zoom Controller */}
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950/60 border border-slate-150 dark:border-slate-800/80 px-2.5 xs:px-3 py-1.5 rounded-xl">
                <span className="text-slate-500 dark:text-slate-400 text-[11px] font-mono select-none">Grid Zoom</span>
                <input
                  type="range"
                  min="2"
                  max="6"
                  value={columnsCount}
                  onChange={(e) => setColumnsCount(parseInt(e.target.value, 10))}
                  className="w-16 xs:w-20 accent-slate-950 dark:accent-indigo-500 h-1 rounded-full cursor-col-resize cursor-pointer"
                  title="Adjust column count dynamically"
                />
                <span className="text-slate-900 dark:text-slate-100 text-[11px] font-bold w-4 text-center">{columnsCount}</span>
              </div>

              {/* Sorter Selector dropdown */}
              <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-150 dark:border-slate-800/80 px-2.5 xs:px-3 py-1.5 rounded-xl text-slate-700 dark:text-slate-300">
                <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                <select
                  value={sortBy}
                  onChange={(e: any) => setSortBy(e.target.value)}
                  className="bg-transparent border-none text-[11px] font-bold focus:outline-none cursor-pointer text-slate-900 dark:text-slate-100 whitespace-nowrap [&>option]:bg-white dark:[&>option]:bg-slate-900 [&>option]:text-slate-900 dark:[&>option]:text-slate-100"
                >
                  <option value="date_desc">Newest Drop</option>
                  <option value="date_asc">Oldest Drop</option>
                  <option value="name_asc">Alphabetical</option>
                  <option value="size_desc">File Size</option>
                </select>
              </div>

              {/* Filter feedback counts */}
              <span className="text-[10px] text-slate-400 dark:text-slate-550 font-mono tracking-wider uppercase ml-1">
                {filteredPhotos.length} of {photos.length} shown
              </span>

            </div>
          </div>
        )}

        {/* MAIN PHOTO GALLERY LAYOUT VIEWPORT */}
        {loadingPhotos ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 bg-white border border-slate-200/80 rounded-[32px]" id="loading_state">
            <RefreshCw className="h-6 w-6 text-slate-500 animate-spin" />
            <p className="text-xs text-slate-400 font-mono tracking-wider">SYNCHRONIZING PHOTOS ARCHIVE</p>
          </div>
        ) : !status?.connected && !guestFolderId ? (
          <div className="max-w-4xl mx-auto space-y-10" id="welcome_and_instructions_wrapper">
            {/* Direct access to instructions playbook without logging in - now at the top of the page */}
            {renderInstructionsPlaybook()}

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 sm:p-12 text-center max-w-md mx-auto shadow-xs" id="no_connection_state">
              <div className="bg-slate-100 dark:bg-slate-950 p-4.5 rounded-full text-indigo-600 dark:text-indigo-400 inline-block mb-4">
                <Lock className="h-7 w-7" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">Google Drive Link Needed</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-2 max-w-sm mx-auto">
                Guests cannot drop pictures and see the gallery until you connect a destination folder. Link your Google Account below to begin.
              </p>

              <div className="mt-8 p-5 border border-slate-150 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 rounded-2xl space-y-4 text-left">


                <button
                  onClick={handleAdminAuthRedirect}
                  disabled={status ? !status.envConfigured : true}
                  className={`w-full font-bold py-3 px-5 rounded-full text-white inline-flex items-center justify-center gap-1.5 transition-all text-xs ${
                    status?.envConfigured 
                      ? "bg-indigo-600 hover:bg-indigo-700 cursor-pointer shadow-3xs" 
                      : "bg-slate-200 dark:bg-slate-800 dark:text-slate-500 text-slate-400 cursor-not-allowed"
                  }`}
                  id="connect_drive_body_button"
                >
                  <span>Connect Google Drive</span>
                  <ChevronRight className="h-4 w-4" />
                </button>

                {status && !status.envConfigured && (
                  <div className="pt-2 border-t border-dashed border-slate-150 dark:border-slate-850 mt-4 space-y-3">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center leading-relaxed font-medium">
                      🔑 Google Drive OAuth API secrets are not configured in system settings yet.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : status?.connected && (!status?.folderId || status?.folderName === "App Uploads Gallery") && !guestFolderId ? (
          /* FORCED FOLDER CONFIGURATION CARD FOR OWNER */
          <div className="bg-white border border-slate-250/50 rounded-[32px] p-8 md:p-12 shadow-xs max-w-3xl mx-auto space-y-6" id="forced_folder_activation">
            <div className="text-center space-y-2">
              <div className="bg-amber-50 h-14 w-14 rounded-full text-amber-500 inline-flex items-center justify-center mb-1">
                <FolderOpen className="h-6 w-6" />
              </div>
              <h3 className="font-extrabold text-slate-900 text-xl tracking-tight">Gallery Selection Required</h3>
              <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
                Before uploading any pictures or generating guest links for <span className="font-semibold font-mono text-slate-800 underline">{status?.ownerEmail || "Somuchfood789@gmail.com"}</span>, you must select which Google Drive folder will host images. This ensures your cloud files remain structured.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 pt-6 border-t border-slate-100">
              {/* Column 1: Choose folder */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                    Select an existing folder:
                  </label>
                  <button 
                    onClick={fetchFoldersList} 
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-950 flex items-center gap-1 cursor-pointer transition-colors"
                    disabled={loadingFolders}
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingFolders ? "animate-spin" : ""}`} />
                    <span>Sync</span>
                  </button>
                </div>

                {loadingFolders ? (
                  <div className="p-10 border border-slate-100 rounded-2xl flex flex-col items-center justify-center gap-2 bg-slate-50/20">
                    <RefreshCw className="h-4 w-4 text-slate-400 animate-spin" />
                    <span className="text-[10px] text-slate-450 font-mono">RESCANNING DRIVE</span>
                  </div>
                ) : folders.length === 0 ? (
                  <div className="p-8 border border-slate-150 border-dashed rounded-2xl text-center bg-slate-50/50 space-y-1">
                    <p className="text-[11px] text-slate-500 font-medium">No Drive folders located.</p>
                    <p className="text-[10px] text-slate-400">Use the creation engine on the right to start a brand new folder.</p>
                  </div>
                ) : (
                  <div className="max-h-52 overflow-y-auto border border-slate-100 rounded-2xl p-2 bg-slate-50/30 space-y-1.5">
                    {folders.map((fld) => {
                      if (fld.name === "App Uploads Gallery") {
                        return (
                          <div
                            key={fld.id}
                            className="w-full text-left p-2.5 bg-slate-100/50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl flex items-center gap-2 cursor-not-allowed opacity-65"
                            title="App default folder"
                          >
                            <FolderOpen className="h-4 w-4 text-slate-400 shrink-0" />
                            <span className="text-xs font-semibold text-slate-455 dark:text-slate-500 truncate">Folders</span>
                          </div>
                        );
                      }
                      return (
                        <button
                          key={fld.id}
                          onClick={() => handleSelectFolder(fld.id, fld.name)}
                          className="w-full text-left p-2.5 bg-white border border-slate-150/40 hover:bg-slate-50 hover:border-slate-355 rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-3xs"
                        >
                          <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                          <span className="text-xs font-semibold text-slate-850 truncate">{fld.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Column 2: Create custom folder */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                  Or create a new custom folder:
                </label>
                <form onSubmit={handleCreateFolder} className="space-y-3">
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-150/40 space-y-4">
                    <p className="text-[11px] text-slate-500 leading-normal">
                      We will automatically initialize your folder inside Google Drive and link it dynamically for immediate drops.
                    </p>
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="e.g. Wedding Photo Drop, Vacation"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-slate-800"
                      disabled={creatingFolder}
                    />
                    <button
                      type="submit"
                      disabled={creatingFolder || !newFolderName.trim()}
                      className="w-full bg-slate-950 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {creatingFolder ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <span>Create & Activate Gallery</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : (
          <section className="space-y-8" id="unified_dropzone_and_photos">
            
            {/* Apple masonry or elegant square columns layout */}
            <div className={`grid ${getGridColsClass()} gap-4 md:gap-5`}>
              
              {/* CARD 1: EXTREMELY INTEGRATED APPLE PUBLIC DROP CARD */}
              <div
                onClick={() => !uploading && fileInputRef.current?.click()}
                className={`relative aspect-square border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center transition-all duration-200 select-none overflow-hidden ${
                  uploading 
                    ? "border-slate-300 bg-white" 
                    : "border-slate-300 hover:border-slate-950 hover:bg-white cursor-pointer bg-white"
                }`}
                title="Click or Drop your picture"
                id="integrated_uploader_card"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  multiple={true}
                />

                {uploading ? (
                  <div className="space-y-3 w-full px-4 text-center">
                    <RefreshCw className="h-6 w-6 text-slate-950 animate-spin mx-auto" />
                    <p className="text-[11px] font-bold text-slate-950 tracking-wider uppercase">Sending to Drive...</p>
                    <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden max-w-[110px] mx-auto">
                      <div 
                        className="bg-slate-950 h-1 rounded-full transition-all duration-300" 
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2.5 p-4">
                    <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl shadow-3xs group-hover:scale-105 transition-all text-slate-900 flex items-center justify-center">
                      <Plus className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-bold text-xs text-slate-900">Drop Photos</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Drag to upload anywhere</p>
                    </div>
                  </div>
                )}
              </div>

              {/* DYNAMIC PHOTO ELEMENT TILES */}
              {filteredPhotos.map((photo) => {
                const isMyUpload = myUploads.includes(photo.id);
                const isSelected = selectedPhotoIds.includes(photo.id);
                return (
                  <motion.div
                    key={photo.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`group relative aspect-square bg-[#eaeaea] rounded-2xl overflow-hidden shadow-3xs flex flex-col object-cover border transition-all duration-300 ${
                      isSelected 
                        ? "ring-4 ring-slate-950 ring-offset-2 scale-[0.98] border-transparent" 
                        : "border-slate-200/40"
                    }`}
                  >
                    {/* Media render wrapper */}
                    <div 
                      className="absolute inset-0 overflow-hidden"
                      onClick={() => {
                        if (isSelecting) {
                          setSelectedPhotoIds(prev => 
                            prev.includes(photo.id) 
                              ? prev.filter(id => id !== photo.id) 
                              : [...prev, photo.id]
                          );
                        } else {
                          setSelectedPhoto(photo);
                        }
                      }}
                      style={{ cursor: isSelecting ? "pointer" : "zoom-in" }}
                    >
                      <img
                        src={`/api/photos/view/${photo.id}`}
                        alt={photo.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                      />
                    </div>

                    {/* Gradient background overlay to guarantee readability of white hover text */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />

                    {/* Hover items action row */}
                    {!isSelecting && (
                      <div className="absolute bottom-0 left-0 right-0 p-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-between pointer-events-auto gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold truncate text-[#ffffff]" title={photo.name}>
                            {photo.name}
                          </p>
                          <p className="text-[9px] text-[#ffffff]/70 font-semibold font-mono tracking-wider mt-0.5 uppercase">
                            {formatFileSize(photo.size) || "Image"} &bull; {isMyUpload ? "Your Drop" : (isOwner ? "Guest Upload" : "Guest")}
                          </p>
                        </div>

                        {(isMyUpload || isOwner) && (
                          <button
                            onClick={() => handleTrashPhoto(photo.id, photo.name)}
                            className="p-1.5 bg-white/10 hover:bg-red-500 hover:text-white rounded-lg transition-colors text-white text-xs mt-auto shrink-0 cursor-pointer"
                            title={isOwner ? "Delete this photo" : "Trash/Delete my accidental drop"}
                            id={`trash_button_${photo.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* IOS Style Selection Checkbox Circle */}
                    {isSelecting && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPhotoIds(prev => 
                            prev.includes(photo.id) 
                              ? prev.filter(id => id !== photo.id) 
                              : [...prev, photo.id]
                          );
                        }}
                        className={`absolute top-3 right-3 h-6 w-6 rounded-full flex items-center justify-center border-2 transition-all z-20 shadow-3xs cursor-pointer ${
                          isSelected 
                            ? "bg-slate-950 border-slate-950 text-white" 
                            : "bg-white/90 border-slate-300 text-transparent hover:border-slate-450"
                        }`}
                      >
                        <Check className="h-4 w-4" strokeWidth={3} />
                      </button>
                    )}

                    {/* Compact corner badge so individuals can identify their uploads instantly */}
                    {isMyUpload && !isSelecting && (
                      <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[8.5px] font-bold bg-white text-slate-950 font-mono tracking-tight shadow-sm z-10 pointer-events-none uppercase">
                        Me
                      </span>
                    )}
                  </motion.div>
                );
              })}

            </div>

            {/* Empty grid filter results caption */}
            {filteredPhotos.length === 0 && (
              <div className="text-center py-16 bg-white border border-slate-250/20 rounded-[32px]" id="empty_gallery_caption">
                <div className="text-slate-350 p-3 bg-slate-50 inline-block rounded-full mb-3">
                  <ImageIcon className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-xs font-bold text-slate-900 uppercase tracking-widest font-mono">No Photos Located</p>
                <p className="text-[11px] text-slate-500 mt-2 max-w-xs mx-auto">No pictures matched your active query. Drop a photo using the card on top to populate the grid.</p>
              </div>
            )}
          </section>
        )}
      </main>

      {/* FULLSCREEN PREVIEW LIGHTBOX WITH TOUCH/LEFT/RIGHT NAVIGATION controls */}
      <AnimatePresence>
        {selectedPhoto && (
          <div 
            className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 bg-white/98 dark:bg-slate-950/98 backdrop-blur-md transition-colors"
            id="lightbox_modal"
            role="dialog"
            aria-modal="true"
          >
            {/* Top Close Actions Row */}
            <div className="w-full max-w-5xl flex justify-between items-center mb-6 z-55 px-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate max-w-xs md:max-w-md" title={selectedPhoto.name}>
                  {selectedPhoto.name}
                </span>
                <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-900 rounded-md text-[9px] font-bold font-mono text-slate-400 dark:text-slate-500 uppercase shrink-0">
                  {formatFileSize(selectedPhoto.size)}
                </span>
              </div>
              <button 
                onClick={() => setSelectedPhoto(null)}
                className="bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 p-2.5 rounded-full transition-all cursor-pointer"
                aria-label="Close modal dialog"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Middle Main Slider with navigation arrows */}
            <div className="max-w-5xl w-full flex-1 flex items-center justify-between xl:gap-8 relative" id="lightbox_slider_body">
              
              {/* Previous button */}
              <button
                onClick={() => navigateLightbox("prev")}
                className="hidden md:flex bg-slate-100 hover:bg-slate-250 text-slate-800 p-3.5 rounded-full transition-all shrink-0 active:scale-90"
                title="Browse Previous"
                aria-label="Previous Photo"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              {/* Main Image Viewport with full-stack safe referral */}
              <div className="flex-1 max-h-[70vh] flex items-center justify-center relative rounded-3xl overflow-hidden px-4">
                <img
                  src={`/api/photos/view/${selectedPhoto.id}`}
                  alt={selectedPhoto.name}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[70vh] object-contain rounded-2xl border border-slate-150 shadow-md bg-slate-50/50"
                  id="lightbox_active_image"
                />
              </div>

              {/* Next button */}
              <button
                onClick={() => navigateLightbox("next")}
                className="hidden md:flex bg-slate-100 hover:bg-slate-250 text-slate-800 p-3.5 rounded-full transition-all shrink-0 active:scale-90"
                title="Browse Next"
                aria-label="Next Photo"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

            </div>

            {/* Bottom Panel buttons and file detail */}
            <div className="mt-6 flex flex-col items-center gap-3">
              
              {/* Quick actions row */}
              <div className="flex flex-wrap items-center gap-2">
                
                {/* Mobile inline arrows navigation comfort */}
                <div className="flex md:hidden bg-slate-100 p-1.5 rounded-full mb-1">
                  <button 
                    onClick={() => navigateLightbox("prev")}
                    className="p-1 px-3 text-slate-600 hover:text-slate-900 border-r border-slate-200"
                  >
                    <ChevronLeft className="h-4.5 w-4.5" />
                  </button>
                  <button 
                    onClick={() => navigateLightbox("next")}
                    className="p-1 px-3 text-slate-600 hover:text-slate-900"
                  >
                    <ChevronRight className="h-4.5 w-4.5" />
                  </button>
                </div>

                {(myUploads.includes(selectedPhoto.id) || isOwner) && (
                  <button
                    onClick={() => handleTrashPhoto(selectedPhoto.id, selectedPhoto.name)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-full shadow-xs transition-all active:scale-95 cursor-pointer"
                    id="lightbox_trash_button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{isOwner && !myUploads.includes(selectedPhoto.id) ? "Delete Photo" : "Delete my photo"}</span>
                  </button>
                )}
                
                <a
                  href={`/api/photos/view/${selectedPhoto.id}`}
                  download={selectedPhoto.name}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-850 text-white font-bold text-xs rounded-full shadow-xs transition-all"
                  id="lightbox_download_link"
                >
                  <span className="md:hidden">Save Image</span>
                  <span className="hidden md:inline">Download</span>
                </a>
              </div>

              <div className="text-[10px] text-slate-400 font-mono text-center">
                Use Left / Right arrow keys to cycle images dynamically (Esc to close)
              </div>
            </div>

          </div>
        )}
      </AnimatePresence>

      {/* Floating Batch Actions iOS Drawer */}
      <AnimatePresence>
        {isSelecting && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-2xl bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-3xl p-4.5 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4"
          >
            {/* Selection info */}
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-900 font-mono text-xs font-bold shadow-4xs">
                {selectedPhotoIds.length}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Photos Selected</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <button
                    onClick={() => {
                      const allIds = filteredPhotos.map(p => p.id);
                      setSelectedPhotoIds(allIds);
                    }}
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-950 cursor-pointer"
                  >
                    Select All ({filteredPhotos.length})
                  </button>
                  <span className="text-slate-300 text-[10px]">&bull;</span>
                  <button
                    onClick={() => setSelectedPhotoIds([])}
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-950 cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            </div>

            {/* Actions list */}
            <div className="flex items-center gap-2 w-full md:w-auto justify-end">
              {/* Trash option for photos inside selection */}
              {(isOwner ? selectedPhotoIds.length > 0 : selectedPhotoIds.some(id => myUploads.includes(id))) && (
                <button
                  onClick={() => {
                    const delets = isOwner 
                      ? selectedPhotoIds 
                      : selectedPhotoIds.filter(id => myUploads.includes(id));
                    handleTrashMultiplePhotos(delets);
                  }}
                  className="px-3.5 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-2xl transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs"
                  title={isOwner ? "Delete selected photos from Drive" : "Trash selected photos uploaded by me"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {isOwner 
                      ? `Delete Selected (${selectedPhotoIds.length})` 
                      : `Delete Ours (${selectedPhotoIds.filter(id => myUploads.includes(id)).length})`
                    }
                  </span>
                </button>
              )}

              {/* Download ZIP button */}
              <button
                disabled={selectedPhotoIds.length === 0 || batchActionLoading}
                onClick={() => {
                  const items = photos.filter(p => selectedPhotoIds.includes(p.id));
                  downloadSelectedPhotosAsZip(items);
                }}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-300 text-slate-700 font-bold text-xs rounded-2xl transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs"
              >
                <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                <span>Zip Archive</span>
              </button>

              {/* Direct Save to Camera Roll (Phone native Share sheet) */}
              <button
                disabled={selectedPhotoIds.length === 0 || batchActionLoading}
                onClick={() => {
                  const items = photos.filter(p => selectedPhotoIds.includes(p.id));
                  shareSelectedPhotosToPhone(items);
                }}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold text-xs rounded-2xl transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs"
                title="Save photos directly to iOS / Android Camera Roll"
              >
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400" strokeWidth={3} />
                <span className="md:hidden">Save to Phone</span>
                <span className="hidden md:inline">Download</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Processing Overlay */}
      {batchActionLoading && (
        <div className="fixed inset-0 z-55 bg-white/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200/80 shadow-2xl rounded-3xl p-6 max-w-sm w-full text-center space-y-4">
            <RefreshCw className="h-7 w-7 text-slate-800 animate-spin mx-auto" />
            <div className="space-y-1">
              <p className="font-bold text-xs text-slate-950 tracking-wide uppercase">{batchActionLabel}</p>
              <p className="text-[10px] text-slate-400">Please do not close this browser or reload page</p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-slate-950 h-1.5 rounded-full transition-all duration-300" 
                style={{ width: `${batchActionProgress}%` }}
              ></div>
            </div>
            <span className="text-[11px] font-mono text-slate-500 font-bold">{batchActionProgress}% completed</span>
          </div>
        </div>
      )}

      {/* Dynamic Custom IFrame-Safe Confirmation Modal */}
      <AnimatePresence>
        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-55 flex items-center justify-center p-4" id="custom_confirm_dialog_container">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="bg-white border border-slate-200/80 shadow-2xl rounded-3xl p-6 max-w-sm w-full text-center space-y-5 relative z-10"
            >
              <div className="space-y-2">
                <h3 className="font-sans font-extrabold text-slate-900 text-lg tracking-tight">
                  {confirmDialog.title}
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {confirmDialog.message}
                </p>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200/80 active:scale-98 text-slate-750 text-xs font-bold rounded-2xl transition-all cursor-pointer border border-slate-200/50"
                >
                  {confirmDialog.cancelText}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const callback = confirmDialog.onConfirm;
                    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                    if (callback) {
                      await callback();
                    }
                  }}
                  className={`flex-1 py-2.5 active:scale-98 text-white text-xs font-bold rounded-2xl transition-all cursor-pointer shadow-xs ${
                    confirmDialog.isDestructive
                      ? "bg-red-600 hover:bg-red-700 shadow-red-100"
                      : "bg-slate-900 hover:bg-slate-800"
                  }`}
                >
                  {confirmDialog.confirmText}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Fullscreen Presenter Cast Mode Event Board */}
      <AnimatePresence>
        {showCastMode && status?.connected && status?.folderId && (
          <div className="fixed inset-0 z-55 flex flex-col justify-between p-6 md:p-12 bg-slate-950 text-white font-sans overflow-y-auto select-none" id="full_screen_presenter_display">
            {/* Ambient decorative glowing spots */}
            <div className="absolute top-1/4 left-1/4 w-[35rem] h-[35rem] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 w-[35rem] h-[35rem] bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

            {/* Top Bar Navigation & Exit */}
            <div className="relative z-10 flex items-center justify-between border-b border-white/5 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/25 rounded-2xl flex items-center justify-center">
                  <Tv className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-extrabold tracking-wider text-slate-200 uppercase font-mono">
                    PhotoDeck Presenter Station
                  </h2>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">LIVE SYNC ACTIVE</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowCastMode(false)}
                className="bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 hover:border-white/20 rounded-2xl px-4 py-2 text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <span>Close Presenter</span>
                <span className="text-[10px] bg-white/15 px-1.5 py-0.5 rounded-sm font-mono font-medium">ESC</span>
              </button>
            </div>

            {/* Main Interactive Center Section */}
            <div className="relative z-10 my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center max-w-6xl mx-auto w-full py-8">
              
              {/* Left Column: Directives & User Value Proposition */}
              <div className="lg:col-span-7 text-left space-y-6">
                <div className="space-y-3">
                  <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest font-mono">
                    Direct-Upload Event Hub
                  </span>
                  <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white leading-none">
                    Drop Your Photos <br />
                    Into Our Shared Album 📸
                  </h1>
                  <p className="text-sm md:text-base text-slate-400 leading-relaxed max-w-xl">
                    No complex signup or apps needed. Simply scan, pick photos, and watch them materialize on the community display instantly!
                  </p>
                </div>

                {/* Steps Timeline visual */}
                <div className="space-y-4 pt-2">
                  <div className="flex items-start gap-4">
                    <div className="h-8 w-8 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                      1
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-100">Scan with Camera</h4>
                      <p className="text-xs text-slate-400 leading-normal">Point your phone's camera at the QR code on the right side of the screen.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="h-8 w-8 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                      2
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-100">Snap or Pick Snaps</h4>
                      <p className="text-xs text-slate-400 leading-normal">Take a fresh photo or choose elements directly from your phone's photo library.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="h-8 w-8 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                      3
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-100">Watch It Screen Live!</h4>
                      <p className="text-xs text-slate-400 leading-normal">Hit upload, and your media feeds directly to this event display in real-time!</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Massive scan-board */}
              <div className="lg:col-span-5 flex flex-col items-center">
                <div className="bg-white text-slate-900 p-6 md:p-8 rounded-[40px] shadow-2xl flex flex-col items-center justify-center relative border-4 border-indigo-500/30 max-w-xs md:max-w-sm w-full transition-all hover:scale-[1.01]">
                  <span className="mb-4 text-[9px] font-extrabold text-indigo-600 uppercase tracking-widest font-mono bg-indigo-50 border border-indigo-150 px-3.5 py-1 rounded-full">
                    Scan To Drop
                  </span>
                  
                  <div className="bg-white p-3.5 rounded-3xl border border-slate-100 flex items-center justify-center shadow-md relative">
                    <QRCodeSVG 
                      value={getPublicGuestUrl(status.folderId!)}
                      size={200}
                      level="H"
                      includeMargin={false}
                      fgColor="#0f172a"
                    />
                    
                    {/* Big lens display */}
                    <div className="absolute inset-0 m-auto h-12 w-12 rounded-full bg-slate-950 border-4 border-white flex items-center justify-center shadow-lg">
                      <ImageIcon className="h-5 w-5 text-indigo-400" />
                    </div>
                  </div>

                  <div className="text-center mt-4 space-y-1">
                    <p className="text-xs font-extrabold text-slate-900 tracking-tight">
                      No Login or Password Required
                    </p>
                    <p className="text-[10px] text-slate-500 leading-normal max-w-[210px] mx-auto">
                      Files are securely hosted inside owner's custom folder: <span className="underline font-bold">"{status.folderName}"</span>.
                    </p>
                  </div>
                </div>
              </div>

            </div>

            {/* Bottom Row - Live Album Feed of last 4 photos */}
            <div className="relative z-10 border-t border-white/5 pt-6 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-1 text-center md:text-left">
                <p className="text-[10px] font-extrabold text-indigo-400 font-mono uppercase tracking-wider">
                  Live Snapshot Activity Feed
                </p>
                <p className="text-xs text-slate-300 flex items-center gap-1.5 justify-center md:justify-start">
                  <span>📁 Active Drive: <strong>{status.folderName}</strong></span>
                  <span className="text-slate-700">&bull;</span>
                  <span>⭐ <strong>{photos.length}</strong> photos collected</span>
                </p>
              </div>

              {/* Latest Recent Photo Drops row */}
              <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto justify-center">
                {photos.length === 0 ? (
                  <span className="text-xs text-slate-500 italic animate-pulse py-2">
                    Awaiting first snapshot... Scan above to drop! ✨
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider pr-1">
                      Recent drops:
                    </span>
                    {photos.slice(0, 4).map((photo) => (
                      <div 
                        key={photo.id}
                        className="relative h-12 w-12 rounded-lg overflow-hidden border border-white/10 shrink-0 shadow-sm hover:scale-105 transition-all cursor-pointer group"
                        onClick={() => {
                          setSelectedPhoto(photo);
                          setShowCastMode(false);
                        }}
                        title={`View ${photo.name}`}
                      >
                        <img 
                          src={`/api/view/${photo.id}`} 
                          alt={photo.name}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-all" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* APPLE PHOTO FOOTER COUNTER SUMMARY */}
      <footer className="border-t border-slate-200 bg-white mt-12 py-12 text-[11px] text-slate-400" id="app_footer">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-1 text-center sm:text-left">
            <p className="font-bold text-slate-900 uppercase font-mono tracking-wider">
              {photos.length} Photos Summary &bull; Size: {formatFileSize(String(totalPhotosSize)) || "0 KB"}
            </p>
            <p className="text-slate-400 font-medium">Multi-guest instant file pipe. Zero intermediate login required.</p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-4 text-xs">
            <button 
              onClick={() => setShowAdminGuide(!showAdminGuide)} 
              className="hover:text-slate-900 transition-colors cursor-pointer font-bold"
            >
              Credentials setup manual
            </button>
            <span className="text-slate-300 select-none">|</span>
            <span className="font-mono text-slate-500">Authorized user email: {status?.ownerEmail || "Somuchfood789@gmail.com"}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
