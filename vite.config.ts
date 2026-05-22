import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, loadEnv, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// When running outside `shopify app dev` (e.g. `remix vite:dev` with a manual
// cloudflared tunnel), the Shopify CLI isn't injecting env vars for us — so we
// must load `.env` into `process.env` ourselves before the Remix plugin loads.
const env = loadEnv("development", process.cwd(), "");
for (const [k, v] of Object.entries(env)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

declare module "@remix-run/node" {
  interface Future {
    v3_singleFetch: true;
  }
}

// CORS preflight for /api/* — POS UI extensions live on cdn.shopify.com and
// fetch our trycloudflare tunnel, so the Authorization header triggers a
// preflight that Remix wouldn't otherwise answer.
function corsPreflight(): Plugin {
  return {
    name: "cors-preflight",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === "OPTIONS" && req.url?.startsWith("/api/")) {
          res.statusCode = 204;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          );
          res.setHeader(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, Accept",
          );
          res.setHeader("Access-Control-Max-Age", "600");
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT || 3000),
    allowedHosts: [".trycloudflare.com", ".ngrok-free.dev", ".ngrok-free.app", ".ngrok.app", "localhost"],
    fs: {
      allow: ["app", "node_modules"],
    },
    hmr: process.env.HMR_SERVER_PORT
      ? {
          protocol: "ws",
          host: "localhost",
          port: Number(process.env.HMR_SERVER_PORT),
          clientPort: Number(process.env.HMR_SERVER_PORT),
        }
      : undefined,
  },
  plugins: [
    corsPreflight(),
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: true,
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
});
