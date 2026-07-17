import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { clearSession, createSession, getSession, validLogin } from "./_lib/auth.js";
import { readFinanceStateWithVersion } from "./_lib/financeState.js";

export default async function handler(req, res) {
  const url = new URL(req.url || "/", "https://finance.nix-p.com");
  const pathname = url.searchParams.get("financePath") || url.pathname;
  if (pathname === "/login") return loginHandler(req, res);
  if (pathname === "/logout") return logoutHandler(req, res);

  const session = getSession(req);
  if (!session || !["finance", "admin"].includes(session.workspace)) return redirect(res, "/login");

  const htmlPath = join(process.cwd(), "apps", "finance", "index.html");
  const snapshot = await readFinanceStateWithVersion();
  const html = (await readFile(htmlPath, "utf8")).replace(
    "<script>",
    `<script>window.__NIXP_FINANCE_STATE__=${JSON.stringify(snapshot.state).replace(/</g, "\\u003c")};window.__NIXP_FINANCE_UPDATED_AT__=${JSON.stringify(snapshot.updatedAt)};</script>\n  <script>`
  );
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(html);
}

async function loginHandler(req, res) {
  const session = getSession(req);
  if (session && ["finance", "admin"].includes(session.workspace)) return redirect(res, "/");
  if (req.method === "GET") return html(res, 200, loginPage());
  if (req.method !== "POST") return html(res, 405, loginPage("Method not allowed."));

  const body = await readBody(req);
  const data = new URLSearchParams(body);
  const username = data.get("username") || "";
  const password = data.get("password") || "";
  if (!validLogin("finance", username, password)) return html(res, 401, loginPage("Invalid credentials."));
  createSession(req, res, "finance", username);
  return redirect(res, "/");
}

function logoutHandler(req, res) {
  clearSession(res);
  return redirect(res, "/login");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("location", location);
  res.setHeader("cache-control", "no-store");
  res.end();
}

function html(res, status, content) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(content);
}

function loginPage(error = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NIXP Finance Login</title>
  <style>
    :root { --dark: #292929; --light: #f1f1f1; --muted: #6f6f6f; --line: rgba(41,41,41,.22); --font: "Founder Grotesk", "Founders Grotesk", "Helvetica Neue", Arial, sans-serif; --header-h: 92px; --footer-h: 52px; --page-pad: clamp(18px, 3vw, 56px); }
    * { box-sizing: border-box; }
    html { background: var(--light); color: var(--dark); font-family: var(--font); }
    body { margin: 0; min-width: 320px; min-height: 100vh; overflow: hidden; background: var(--light); color: var(--dark); font-size: 15px; line-height: 1.42; }
    button, input { font: inherit; }
    .site-header, .site-footer { position: fixed; left: 0; z-index: 2; width: 100%; padding-inline: var(--page-pad); display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; font-size: 11px; font-weight: 760; line-height: 1; text-transform: uppercase; }
    .site-header { top: 0; height: var(--header-h); border-bottom: 1px solid var(--line); }
    .site-footer { bottom: 0; height: var(--footer-h); border-top: 1px solid var(--line); }
    .brand { justify-self: center; font-size: 15px; font-weight: 640; text-transform: none; }
    .right { justify-self: end; }
    main { min-height: 100vh; padding: var(--header-h) var(--page-pad) var(--footer-h); display: grid; place-items: center; }
    .login-panel { width: min(420px, 100%); display: grid; gap: 24px; }
    .kicker, label, button, .error, .meta { font-size: 10px; font-weight: 760; line-height: 1.2; text-transform: uppercase; }
    .kicker { margin: 0 0 14px; }
    h1 { margin: 0; max-width: 8ch; font-size: clamp(44px, 9vw, 86px); font-weight: 760; line-height: .9; text-transform: uppercase; }
    .lede { margin: 18px 0 0; max-width: 34ch; color: var(--muted); font-size: 12px; font-weight: 640; line-height: 1.45; text-transform: uppercase; }
    form { display: grid; gap: 12px; border-top: 1px solid var(--dark); padding-top: 16px; }
    label { display: grid; gap: 7px; }
    input { width: 100%; min-height: 42px; border: 1px solid var(--dark); border-radius: 0; background: transparent; color: var(--dark); padding: 10px 11px; outline: none; }
    input:focus { box-shadow: inset 0 0 0 1px var(--dark); }
    button { min-height: 42px; border: 1px solid var(--dark); border-radius: 0; background: var(--dark); color: var(--light); cursor: pointer; }
    button:hover { background: transparent; color: var(--dark); }
    .error { min-height: 14px; margin: 0; color: #9d1d1d; }
    .meta { color: var(--muted); }
  </style>
</head>
<body>
  <header class="site-header"><span>Finance</span><span class="brand">Nixp</span><span class="right">Private</span></header>
  <main>
    <section class="login-panel" aria-label="Finance login">
      <div><p class="kicker">Restricted workspace</p><h1>NIXP Finance</h1><p class="lede">Private cashflow, stock, sales and inventory platform.</p></div>
      <form method="post" action="/login">
        <label>Username<input name="username" type="text" autocomplete="username" autofocus></label>
        <label>Password<input name="password" type="password" autocomplete="current-password"></label>
        <button type="submit">Enter finance</button>
        <p class="error">${escapeHtml(error)}</p>
      </form>
    </section>
  </main>
  <footer class="site-footer"><span>Online</span><span class="brand">Nix Powell</span><span class="right meta">Login required</span></footer>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
