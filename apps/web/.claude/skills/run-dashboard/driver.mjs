// Driver for the Splyntra dashboard (apps/web) — launches headless Google
// Chrome via puppeteer-core, drives the login/signup flow, and screenshots
// authenticated routes. This is agent tooling, not product code.
//
// Usage:
//   node driver.mjs signup [email] [password]     # create first user (owner) + screenshot home
//   node driver.mjs shot <route> [outfile]        # log in (env creds) + screenshot a route
//   node driver.mjs shots <route,route,...>       # log in once, screenshot several routes
//   node driver.mjs open <route>                  # log in + dump page <title> and h1 text
//
// Env:
//   BASE_URL   default http://localhost:3000
//   EMAIL      default dev@splyntra.local     (login creds; signup uses these too)
//   PASSWORD   default splyntra-dev-pw
//   CHROME     path to Chrome binary (auto-detected on macOS if unset)
//   OUTDIR     screenshot dir (default ./shots under the skill directory)

import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = process.env.EMAIL || "dev@splyntra.local";
const PASSWORD = process.env.PASSWORD || "splyntra-dev-pw";
const OUTDIR = process.env.OUTDIR || join(HERE, "shots");

function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("Chrome not found — set CHROME=/path/to/chrome");
}

async function launch() {
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });
}

async function shot(page, name) {
  mkdirSync(OUTDIR, { recursive: true });
  const file = name.endsWith(".png") ? resolve(name) : join(OUTDIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("screenshot:", file);
  return file;
}

// Fill the /signup form and submit. First user in the seeded dev org → owner.
async function doSignup(page, email, password) {
  await page.goto(`${BASE_URL}/signup`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="name"]', "Dev User").catch(() => {});
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
  ]);
}

// Fill the /login credentials form and submit.
async function doLogin(page, email, password) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
  ]);
}

async function ensureLoggedIn(page) {
  await doLogin(page, EMAIL, PASSWORD);
  // If still on /login (bad creds / no user), fall back to signup.
  if (new URL(page.url()).pathname.startsWith("/login")) {
    await doSignup(page, EMAIL, PASSWORD);
  }
  return !new URL(page.url()).pathname.startsWith("/login");
}

const [cmd, ...rest] = process.argv.slice(2);
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.error("[page error]", m.text()); });

  if (cmd === "signup") {
    const email = rest[0] || EMAIL;
    const password = rest[1] || PASSWORD;
    await doSignup(page, email, password);
    console.log("after signup, url:", page.url());
    await shot(page, "home");
  } else if (cmd === "shot") {
    const route = rest[0] || "/";
    const out = rest[1] || route.replace(/\W+/g, "_").replace(/^_|_$/g, "") || "home";
    await ensureLoggedIn(page);
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle0" });
    console.log("url:", page.url());
    await shot(page, out);
  } else if (cmd === "shots") {
    const routes = (rest[0] || "/").split(",").map((r) => r.trim()).filter(Boolean);
    await ensureLoggedIn(page);
    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle0" });
      const out = route.replace(/\W+/g, "_").replace(/^_|_$/g, "") || "home";
      await shot(page, out);
    }
  } else if (cmd === "open") {
    const route = rest[0] || "/";
    await ensureLoggedIn(page);
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle0" });
    const info = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim() || null,
      url: location.href,
    }));
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.error("commands: signup | shot <route> [out] | shots <r,r,...> | open <route>");
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
