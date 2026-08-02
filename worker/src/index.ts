/// <reference path="./env.d.ts" />

type WorkerEnv = Env & { ADMIN_TOKEN: string };

type PhotoRow = {
  id: string;
  filename: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  captured_at: string | null;
  uploaded_at: string;
  caption: string | null;
};

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const maxPhotoBytes = 24 * 1024 * 1024;

function corsHeaders(request: Request, env: WorkerEnv) {
  const origin = request.headers.get("Origin");
  const allowed = new URL(env.FRONTEND_URL).origin;
  if (!origin || origin !== allowed) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request: Request, env: WorkerEnv, body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...corsHeaders(request, env), "Cache-Control": "no-store" } });
}

function textField(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function secureEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function isAdmin(request: Request, env: WorkerEnv) {
  if (!env.ADMIN_TOKEN) return false;
  const authorization = request.headers.get("Authorization") ?? "";
  return secureEqual(authorization, `Bearer ${env.ADMIN_TOKEN}`);
}

async function listPhotos(request: Request, env: WorkerEnv) {
  const result = await env.DB.prepare("SELECT id,filename,latitude,longitude,city,country,captured_at,uploaded_at,caption FROM photos ORDER BY COALESCE(captured_at,uploaded_at) DESC LIMIT 1000").all<PhotoRow>();
  const origin = new URL(request.url).origin;
  return json(request, env, { photos: result.results.map((row) => ({ id: row.id, src: `${origin}/api/media/${row.id}`, filename: row.filename, latitude: row.latitude, longitude: row.longitude, city: row.city, country: row.country, capturedAt: row.captured_at, uploadedAt: row.uploaded_at, caption: row.caption })) });
}

async function createUploadSession(request: Request, env: WorkerEnv) {
  if (!(await isAdmin(request, env))) return json(request, env, { error: "Incorrect private upload key" }, 401);
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60 * 1000);
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM upload_sessions WHERE expires_at<=?").bind(now.toISOString()),
    env.DB.prepare("INSERT INTO upload_sessions(token,expires_at,created_at) VALUES(?,?,?)").bind(token, expires.toISOString(), now.toISOString()),
  ]);
  const uploadUrl = new URL(env.FRONTEND_URL);
  uploadUrl.searchParams.set("upload", token);
  return json(request, env, { token, expiresAt: expires.toISOString(), uploadUrl: uploadUrl.toString() }, 201);
}

async function uploadPhoto(request: Request, env: WorkerEnv) {
  const form = await request.formData();
  const token = textField(form, "token");
  const file = form.get("photo");
  const latitude = Number(textField(form, "latitude"));
  const longitude = Number(textField(form, "longitude"));
  if (!token || !(file instanceof File)) return json(request, env, { error: "Photo and upload link required" }, 400);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return json(request, env, { error: "Valid map location required" }, 400);
  if (!allowedTypes.has(file.type) || file.size > maxPhotoBytes) return json(request, env, { error: "Use a JPEG, PNG, WebP, or HEIC image under 24 MB" }, 400);
  const now = new Date().toISOString();
  const session = await env.DB.prepare("SELECT token FROM upload_sessions WHERE token=? AND expires_at>?").bind(token, now).first();
  if (!session) return json(request, env, { error: "Upload link expired. Scan the refreshed code." }, 401);
  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100) || "photo.jpg";
  const objectKey = `photos/${id}/${safeName}`;
  await env.BUCKET.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type } });
  try {
    await env.DB.prepare("INSERT INTO photos(id,object_key,filename,content_type,byte_size,latitude,longitude,city,country,captured_at,uploaded_at,caption) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, objectKey, file.name, file.type, file.size, latitude, longitude, textField(form, "city") || "From photo GPS", textField(form, "country"), textField(form, "capturedAt") || null, now, textField(form, "caption") || null).run();
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }
  return json(request, env, { id, src: `${new URL(request.url).origin}/api/media/${id}` }, 201);
}

async function servePhoto(request: Request, env: WorkerEnv, id: string) {
  const row = await env.DB.prepare("SELECT object_key,content_type FROM photos WHERE id=?").bind(id).first<{ object_key: string; content_type: string }>();
  if (!row) return new Response("Not found", { status: 404, headers: corsHeaders(request, env) });
  const object = await env.BUCKET.get(row.object_key);
  if (!object) return new Response("Not found", { status: 404, headers: corsHeaders(request, env) });
  const headers = new Headers(corsHeaders(request, env));
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", row.content_type);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      if (request.method === "GET" && url.pathname === "/api/photos") return await listPhotos(request, env);
      if (request.method === "POST" && url.pathname === "/api/upload-session") return await createUploadSession(request, env);
      if (request.method === "POST" && url.pathname === "/api/upload") return await uploadPhoto(request, env);
      if (request.method === "GET" && url.pathname.startsWith("/api/media/")) return await servePhoto(request, env, url.pathname.slice("/api/media/".length));
      if (request.method === "GET" && url.pathname === "/health") return json(request, env, { ok: true });
      return json(request, env, { error: "Not found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", method: request.method, path: url.pathname, message: error instanceof Error ? error.message : "Unknown error" }));
      return json(request, env, { error: "Service unavailable" }, 503);
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
