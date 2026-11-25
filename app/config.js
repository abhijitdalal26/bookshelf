// Settings for the hosted (Vercel) site. The local server ignores these.
// googleClientId: OAuth 2.0 Web client ID from Google Cloud Console (not a secret).
// driveFolder: the top-level folder in My Drive that mirrors your books folder (fallback source, notes).
window.SHELF_CONFIG = {
  googleClientId: "32388930333-nfqniv85c4p0fi2qniv7091q6p313vod.apps.googleusercontent.com",
  driveFolder: "Books",
  // the Worker (worker/) that serves the PDFs from Cloudflare R2; books not there come from Drive
  filesUrl: "https://bookshelf-files.abhijitdalal2609.workers.dev",
};
