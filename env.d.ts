/// <reference types="@remix-run/node" />
/// <reference types="vite/client" />

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      SHOPIFY_API_KEY: string;
      SHOPIFY_API_SECRET: string;
      SHOPIFY_APP_URL: string;
      SCOPES: string;
      DATABASE_URL: string;
      SHOPIFY_API_VERSION?: string;
      SHOPIFY_SEED_SHOP?: string;
    }
  }
}

export {};
