const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { MongoClient } = require("mongodb");

const port = Number(process.env.PORT || 8000);
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const databaseName = process.env.MONGODB_DB || "techfit";
const distDirectory = path.join(__dirname, "dist");
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;
const passwordIterations = 210000;
const workouts = new Map([
  ["Destrave as costas", { minutes: 6, plan: "free" }],
  ["Reset para os punhos", { minutes: 5, plan: "free" }],
  ["Pescoço sem tensão", { minutes: 8, plan: "premium" }],
  ["Fim de expediente", { minutes: 10, plan: "premium" }]
]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const client = new MongoClient(mongoUri);
let database;
let users;
let authSessions;
let workoutSessions;
let comfortEntries;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ApiError(400, "Informe valores de desconforto válidos.");
  return Math.min(10, Math.max(0, Math.round(number)));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, passwordIterations, 32, "sha256").toString("hex");
  return { salt, hash, iterations: passwordIterations };
}

function verifyPassword(password, passwordData) {
  if (!passwordData?.salt || !passwordData?.hash) return false;
  const candidate = crypto.pbkdf2Sync(password, passwordData.salt, passwordData.iterations || passwordIterations, 32, "sha256");
  const stored = Buffer.from(passwordData.hash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function serializeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    plan: user.plan,
    preferences: {
      reminders: user.preferences?.reminders !== false,
      sounds: user.preferences?.sounds === true,
      reminderMinutes: 90
    },
    createdAt: user.createdAt
  };
}

function responseHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    ...extra
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, responseHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let content = "";
  for await (const chunk of request) {
    content += chunk;
    if (content.length > 1_000_000) throw new ApiError(413, "Requisição muito grande.");
  }
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch {
    throw new ApiError(400, "JSON inválido.");
  }
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  await authSessions.insertOne({
    userId,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + sessionDurationMs)
  });
  return token;
}

async function authenticate(request) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "Faça login para continuar.");
  const session = await authSessions.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!session) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  const user = await users.findOne({ _id: session.userId });
  if (!user) throw new ApiError(401, "Usuário não encontrado.");
  return { token, session, user };
}

async function register(request, response) {
  const body = await readJson(request);
  const name = String(body.name || "").trim().slice(0, 60);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (name.length < 2) throw new ApiError(400, "Informe um nome com pelo menos 2 caracteres.");
  if (!validateEmail(email)) throw new ApiError(400, "Informe um e-mail válido.");
  if (password.length < 8) throw new ApiError(400, "A senha deve ter pelo menos 8 caracteres.");
  const now = new Date();
  let result;
  try {
    result = await users.insertOne({
      name,
      email,
      password: hashPassword(password),
      plan: "free",
      preferences: { reminders: true, sounds: false, reminderMinutes: 90 },
      createdAt: now,
      updatedAt: now
    });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "Já existe uma conta com este e-mail.");
    throw error;
  }
  const user = await users.findOne({ _id: result.insertedId });
  const token = await createSession(user._id);
  sendJson(response, 201, { token, user: serializeUser(user) });
}

async function login(request, response) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const user = await users.findOne({ email });
  if (!user || !verifyPassword(password, user.password)) throw new ApiError(401, "E-mail ou senha incorretos.");
  const token = await createSession(user._id);
  sendJson(response, 200, { token, user: serializeUser(user) });
}

async function getBootstrap(request, response) {
  const { user } = await authenticate(request);
  const [sessions, comfort] = await Promise.all([
    workoutSessions.find({ userId: user._id }).sort({ completedAt: 1 }).toArray(),
    comfortEntries.find({ userId: user._id }).sort({ recordedAt: 1 }).toArray()
  ]);
  sendJson(response, 200, {
    user: serializeUser(user),
    sessions: sessions.map(session => ({
      id: session._id.toString(),
      name: session.name,
      minutes: session.minutes,
      completedAt: session.completedAt
    })),
    comfortEntries: comfort.map(entry => ({
      id: entry._id.toString(),
      values: entry.values,
      recordedAt: entry.recordedAt
    }))
  });
}

async function updateProfile(request, response) {
  const { user } = await authenticate(request);
  const body = await readJson(request);
  const name = String(body.name || "").trim().slice(0, 60);
  if (name.length < 2) throw new ApiError(400, "Informe um nome com pelo menos 2 caracteres.");
  await users.updateOne({ _id: user._id }, { $set: { name, updatedAt: new Date() } });
  const updated = await users.findOne({ _id: user._id });
  sendJson(response, 200, { user: serializeUser(updated) });
}

async function updatePlan(request, response) {
  const { user } = await authenticate(request);
  const body = await readJson(request);
  const plan = body.plan === "premium" ? "premium" : body.plan === "free" ? "free" : null;
  if (!plan) throw new ApiError(400, "Plano inválido.");
  await users.updateOne({ _id: user._id }, { $set: { plan, updatedAt: new Date() } });
  const updated = await users.findOne({ _id: user._id });
  sendJson(response, 200, { user: serializeUser(updated) });
}

async function updatePreferences(request, response) {
  const { user } = await authenticate(request);
  const body = await readJson(request);
  const preferences = {
    reminders: body.reminders !== false,
    sounds: body.sounds === true,
    reminderMinutes: 90
  };
  await users.updateOne({ _id: user._id }, { $set: { preferences, updatedAt: new Date() } });
  sendJson(response, 200, { preferences });
}

async function createWorkoutSession(request, response) {
  const { user } = await authenticate(request);
  const body = await readJson(request);
  const name = String(body.name || "");
  const workout = workouts.get(name);
  if (!workout) throw new ApiError(400, "Treino inválido.");
  if (workout.plan === "premium" && user.plan !== "premium") throw new ApiError(403, "Este treino exige o plano Premium.");
  const completedAt = new Date();
  const result = await workoutSessions.insertOne({ userId: user._id, name, minutes: workout.minutes, completedAt });
  sendJson(response, 201, { session: { id: result.insertedId.toString(), name, minutes: workout.minutes, completedAt } });
}

async function createComfortEntry(request, response) {
  const { user } = await authenticate(request);
  if (user.plan !== "premium") throw new ApiError(403, "O relatório de bem-estar exige o plano Premium.");
  const body = await readJson(request);
  const values = {
    lowerBack: clampScore(body.values?.lowerBack),
    wrists: clampScore(body.values?.wrists),
    neck: clampScore(body.values?.neck)
  };
  const recordedAt = new Date();
  const result = await comfortEntries.insertOne({ userId: user._id, values, recordedAt });
  sendJson(response, 201, { entry: { id: result.insertedId.toString(), values, recordedAt } });
}

async function logout(request, response) {
  const { session } = await authenticate(request);
  await authSessions.deleteOne({ _id: session._id });
  sendJson(response, 200, { message: "Sessão encerrada." });
}

async function clearUserData(request, response) {
  const { user } = await authenticate(request);
  await Promise.all([
    workoutSessions.deleteMany({ userId: user._id }),
    comfortEntries.deleteMany({ userId: user._id })
  ]);
  sendJson(response, 200, { message: "Histórico removido." });
}

async function routeApi(request, response, pathname) {
  if (request.method === "POST" && pathname === "/api/auth/register") return register(request, response);
  if (request.method === "POST" && pathname === "/api/auth/login") return login(request, response);
  if (request.method === "POST" && pathname === "/api/auth/logout") return logout(request, response);
  if (request.method === "GET" && pathname === "/api/bootstrap") return getBootstrap(request, response);
  if (request.method === "PATCH" && pathname === "/api/me") return updateProfile(request, response);
  if (request.method === "PATCH" && pathname === "/api/me/plan") return updatePlan(request, response);
  if (request.method === "PATCH" && pathname === "/api/preferences") return updatePreferences(request, response);
  if (request.method === "POST" && pathname === "/api/sessions") return createWorkoutSession(request, response);
  if (request.method === "POST" && pathname === "/api/comfort") return createComfortEntry(request, response);
  if (request.method === "DELETE" && pathname === "/api/data") return clearUserData(request, response);
  if (request.method === "GET" && pathname === "/api/health") {
    await database.command({ ping: 1 });
    return sendJson(response, 200, { status: "ok", database: databaseName });
  }
  throw new ApiError(404, "Rota não encontrada.");
}

async function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(distDirectory, `.${decodeURIComponent(requestedPath)}`);
  if (!filePath.startsWith(`${distDirectory}${path.sep}`)) throw new ApiError(403, "Acesso negado.");
  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") throw new ApiError(404, "Arquivo não encontrado.");
    throw error;
  }
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, responseHeaders({
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
    "Cache-Control": [".html", ".css", ".js"].includes(extension) ? "no-cache" : "public, max-age=300"
  }));
  response.end(content);
}

async function handleRequest(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, responseHeaders());
    response.end();
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await routeApi(request, response, url.pathname);
    else if (request.method === "GET" || request.method === "HEAD") await serveStatic(response, url.pathname);
    else throw new ApiError(405, "Método não permitido.");
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : "Erro interno do servidor.";
    if (status === 500) console.error(error);
    if (!response.headersSent) sendJson(response, status, { error: message });
    else response.end();
  }
}

async function start() {
  await client.connect();
  database = client.db(databaseName);
  users = database.collection("users");
  authSessions = database.collection("auth_sessions");
  workoutSessions = database.collection("workout_sessions");
  comfortEntries = database.collection("comfort_entries");
  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    authSessions.createIndex({ tokenHash: 1 }, { unique: true }),
    authSessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    workoutSessions.createIndex({ userId: 1, completedAt: 1 }),
    comfortEntries.createIndex({ userId: 1, recordedAt: 1 })
  ]);
  const server = http.createServer(handleRequest);
  server.listen(port, "0.0.0.0", () => {
    console.log(`TechFit disponível em http://localhost:${port}`);
    console.log(`MongoDB: ${databaseName}`);
  });
  const shutdown = () => server.close(async () => {
    await client.close();
    process.exit(0);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch(error => {
  console.error("Não foi possível iniciar o TechFit.", error);
  process.exit(1);
});
