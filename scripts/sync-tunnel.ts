import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const rawUrl = process.argv[2] ?? readEnvValue("SHOPIFY_APP_URL");

if (!rawUrl) {
  console.error("Usage: pnpm tunnel:sync https://your-tunnel.trycloudflare.com");
  console.error("Or set SHOPIFY_APP_URL in .env and run: pnpm tunnel:sync");
  process.exit(1);
}

const appUrl = normalizeUrl(rawUrl);

updateEnv(appUrl);
updateShopifyAppToml(appUrl);
updateExtensionConfigs(appUrl);

console.log(`Synced tunnel URL: ${appUrl}`);
console.log("Next: deploy/redeploy so Shopify and POS extension bundles receive the new URL.");

function normalizeUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") throw new Error("URL must use https");
    return url.toString().replace(/\/+$/, "");
  } catch (err) {
    throw new Error(`Invalid tunnel URL: ${value}. Expected https://...`);
  }
}

function readEnvValue(key: string): string | undefined {
  const envPath = join(root, ".env");
  try {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(new RegExp(`^${key}=(.*)$`));
      if (match) return match[1]?.trim();
    }
  } catch {
    return undefined;
  }
}

function updateEnv(appUrl: string): void {
  const envPath = join(root, ".env");
  let text = "";
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    // create below
  }

  if (/^SHOPIFY_APP_URL=/m.test(text)) {
    text = text.replace(/^SHOPIFY_APP_URL=.*$/m, `SHOPIFY_APP_URL=${appUrl}`);
  } else {
    text = `${text.replace(/\s*$/, "")}\nSHOPIFY_APP_URL=${appUrl}\n`;
  }
  writeFileSync(envPath, ensureTrailingNewline(text));
}

function updateShopifyAppToml(appUrl: string): void {
  const tomlPath = join(root, "shopify.app.toml");
  let text = readFileSync(tomlPath, "utf8");
  text = text.replace(/^application_url = ".*"$/m, `application_url = "${appUrl}"`);
  text = text.replace(/"https:\/\/[^/\"]+\/auth\/callback"/g, `"${appUrl}/auth/callback"`);
  text = text.replace(/"https:\/\/[^/\"]+\/auth\/shopify\/callback"/g, `"${appUrl}/auth/shopify/callback"`);
  text = text.replace(/"https:\/\/[^/\"]+\/api\/auth\/callback"/g, `"${appUrl}/api/auth/callback"`);
  writeFileSync(tomlPath, ensureTrailingNewline(text));
}

function updateExtensionConfigs(appUrl: string): void {
  const extensionRoot = join(root, "extensions");
  const configs = [
    ...findFiles(extensionRoot, "src/shared/config.ts"),
    ...findFiles(extensionRoot, "src/shared/config.js"),
  ];
  for (const configPath of configs) {
    let text = readFileSync(configPath, "utf8");
    text = text.replace(
      /export const BACKEND_URL = "https:\/\/[^\"]+";/,
      `export const BACKEND_URL = "${appUrl}";`,
    );
    writeFileSync(configPath, ensureTrailingNewline(text));
  }
  console.log(`Updated ${configs.length} extension config file(s).`);
}

function findFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...findFiles(path, suffix));
    } else if (path.endsWith(suffix)) {
      out.push(path);
    }
  }
  return out;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
