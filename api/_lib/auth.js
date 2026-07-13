import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "nixp_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

function secret() {
  return (
    process.env.NIXP_SESSION_SECRET ||
    process.env.NIXP_ADMIN_PASSWORD ||
    process.env.NIXP_FINANCE_PASSWORD ||
    "nixp-local-session-secret"
  );
}

function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function getSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.expiresAt || Date.now() > session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

function secureCookie(req) {
  const host = String(req?.headers?.host || "");
  const proto = String(req?.headers?.["x-forwarded-proto"] || "");
  return proto === "https" || (!host.includes("localhost") && !host.startsWith("127.0.0.1"));
}

export function createSession(req, res, workspace, username) {
  const payload = Buffer.from(
    JSON.stringify({
      id: randomBytes(12).toString("hex"),
      workspace,
      username,
      expiresAt: Date.now() + MAX_AGE_SECONDS * 1000
    })
  ).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; ${secureCookie(req) ? "Secure; " : ""}SameSite=Lax`
  );
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

export function requireWorkspace(req, res, workspace) {
  const session = getSession(req);
  if (!session || session.workspace !== workspace) {
    json(res, 401, { ok: false, error: `${workspace === "finance" ? "Finance" : "Admin"} login required` });
    return null;
  }
  return session;
}

export function validLogin(workspace, username, password) {
  const expectedUser = workspace === "finance" ? process.env.NIXP_FINANCE_USERNAME : process.env.NIXP_ADMIN_USERNAME;
  const expectedPass = workspace === "finance" ? process.env.NIXP_FINANCE_PASSWORD : process.env.NIXP_ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) return false;
  return safeEqual(username, expectedUser) && safeEqual(password, expectedPass);
}

export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}
