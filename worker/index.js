// Serves the book PDFs from the private R2 bucket to the hosted shelf.
//
// GET /session  with `Authorization: Bearer <Google access token>`
//   The token must belong to this site's OAuth client and to the owner's Google account.
//   Answers { pass, exp, sizes }: a pass signed with SIGNING_KEY (valid PASS_DAYS) and every
//   book's size, so the reader needs no further round trips to Google or extra HEAD requests.
// GET /<path under D:\Books>?p=<pass>   (Range supported)
//   The pass is checked locally (HMAC), so each page request costs only the R2 read. It rides in
//   the URL, and a single Range header is CORS-safelisted, so there is no preflight either.

const PASS_DAYS = 7;
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let keyP = null;
const hmacKey = (env) => (keyP ||= crypto.subtle.importKey("raw", enc.encode(env.SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
async function sign(env, exp) {
  return `${exp}.${b64url(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(`pass:${exp}`)))}`;
}
async function passOk(env, pass) {
  const exp = +(pass || "").split(".")[0];
  if (!exp || exp < Date.now()) return false;
  const want = await sign(env, exp);
  if (want.length !== pass.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ pass.charCodeAt(i);
  return d === 0;
}

// is this Google access token the owner's, issued to this site?
async function ownerToken(token, env) {
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!info.ok) return false;
  const ti = await info.json();
  if (ti.aud !== env.GOOGLE_CLIENT_ID || !(+ti.expires_in > 0)) return false;
  // the Drive scope can tell us whose token it is without asking for the email scope
  const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!about.ok) return false;
  return (await about.json())?.user?.emailAddress?.toLowerCase() === env.OWNER_EMAIL.toLowerCase();
}

async function allSizes(env) {
  const sizes = {};
  let cursor;
  do {
    const page = await env.BOOKS.list({ cursor, limit: 1000 });
    for (const o of page.objects) sizes[o.key] = o.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return sizes;
}

const json = (o, status, headers) =>
  new Response(JSON.stringify(o), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const ok = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).includes(origin);
    const cors = ok ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Range",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag",
      "Access-Control-Max-Age": "7200",
      Vary: "Origin",
    } : { Vary: "Origin" };

    if (req.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method" }, 405, cors);

    const url = new URL(req.url);
    if (url.pathname === "/session") {
      const auth = req.headers.get("Authorization") || "";
      if (!auth.startsWith("Bearer ") || !(await ownerToken(auth.slice(7), env))) return json({ error: "unauthorized" }, 401, cors);
      const exp = Date.now() + PASS_DAYS * 864e5;
      return json({ pass: await sign(env, exp), exp, sizes: await allSizes(env) }, 200, cors);
    }

    if (!(await passOk(env, url.searchParams.get("p")))) return json({ error: "unauthorized" }, 401, cors);
    const key = decodeURIComponent(url.pathname.slice(1));
    const obj = req.method === "HEAD" ? await env.BOOKS.head(key) : await env.BOOKS.get(key, { range: req.headers });
    if (!obj) return json({ error: "not found" }, 404, cors);

    const headers = new Headers(cors);
    obj.writeHttpMetadata(headers);
    headers.set("ETag", obj.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, max-age=604800");
    headers.set("Content-Type", "application/pdf");

    const r = obj.range;
    if (req.method === "GET" && r && req.headers.has("Range")) {
      const start = "suffix" in r ? obj.size - r.suffix : r.offset;
      const len = "suffix" in r ? r.suffix : (r.length ?? obj.size - r.offset);
      headers.set("Content-Range", `bytes ${start}-${start + len - 1}/${obj.size}`);
      headers.set("Content-Length", String(len));
      return new Response(obj.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(obj.size));
    return new Response(req.method === "HEAD" ? null : obj.body, { status: 200, headers });
  },
};
