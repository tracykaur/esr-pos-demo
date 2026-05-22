// Backend URL — POS UI extensions run in a webview hosted on Shopify's CDN,
// so relative fetch paths (/api/...) resolve to the CDN, not your backend.
// We must use the full URL.
//
// Cloudflared quick tunnel pointing at localhost:5050. URL persists as long as
// the cloudflared process is running.
// Run with: `cloudflared tunnel --url http://localhost:5050`
export const BACKEND_URL = "https://street-algorithm-federation-vessels.trycloudflare.com";
