import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { queryCamera0AAE } from "./rcp.js";
import { discoverFromVRM } from "./discovery.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


const PORT            = parseInt(process.env.PORT || "3000", 10);
const CAM_USER        = process.env.CAM_USER || "";
const CAM_PASS        = process.env.CAM_PASS || "";
const CAM_CHANNEL     = parseInt(process.env.CAM_CHANNEL || "1", 10);
const CAM_SECURE      = String(process.env.CAM_SECURE || "false").toLowerCase()==="true";

const CAM_TIMEOUT_MS  = parseInt(process.env.CAM_TIMEOUT_MS || "2500", 10);
const POLL_CONCURRENCY= parseInt(process.env.POLL_CONCURRENCY || "6", 10);
const POLL_PERIOD_MS  = parseInt(process.env.POLL_PERIOD_MS || "5000", 10);

const VRM_HOSTS       = (process.env.VRM_HOSTS || "").split(",").map(s=>s.trim()).filter(Boolean);
const VRM_USER        = process.env.VRM_USER || "";
const VRM_PASS        = process.env.VRM_PASS || "";
const VRM_SECURE      = String(process.env.VRM_USE_HTTPS || "true").toLowerCase()==="true";

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CAM_TXT  = path.join(DATA_DIR, "cameras.txt");
const CAM_JSON = path.join(DATA_DIR, "cameras.json");


const START = Date.now();
app.get("/health", (req,res)=> {
  res.json({ ok:true, up_ms: Date.now()-START, cameras: (globalThis.cameras?.length ?? 0) });
});


app.use((req,res,next)=>{
  const t0 = Date.now();
  res.on("finish", ()=> console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now()-t0}ms)`));
  next();
});


function parseLine(line){
  const t = (line || "").trim();
  if (!t) return null;
  const m = t.match(/^\s*"([^"]+)"\s*,\s*([^,]+)\s*$/);
  if (m) return { name: m[1].trim(), ip: m[2].trim() };
  const parts = t.split(",").map(s=>s.trim());
  if (parts.length >= 2) return { name: parts[0], ip: parts[1] };
  return { name: null, ip: parts[0] || t };
}
function readCamerasTxt(){
  if (!fs.existsSync(CAM_TXT)) return [];
  const lines = fs.readFileSync(CAM_TXT, "utf8").split(/\r?\n/);
  const items = lines.map(parseLine).filter(Boolean);
  const map = new Map(items.map(o=>[o.ip, o]));
  return Array.from(map.values());
}
function readCamerasJson(){
  if (!fs.existsSync(CAM_JSON)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(CAM_JSON, "utf8"));
    if (Array.isArray(j)) return j.filter(x=>x && x.ip);
  } catch {}
  return null;
}
function saveCamerasJson(items){
  fs.writeFileSync(CAM_JSON, JSON.stringify(items, null, 2), "utf8");
}
function saveCamerasTxt(items){
  const txt = items.map(o => o.name ? `${o.name},${o.ip}` : o.ip).join("\n");
  fs.writeFileSync(CAM_TXT, txt, "utf8");
}

function loadCameras(){
  return readCamerasJson() || readCamerasTxt();
}


let cameras = loadCameras();          
let lastStatus = [];                  
let polling = false;
let intervalHandle = null;


async function pollOnce(){
  const queue = cameras.slice();      // shallow copy
  const results = [];
  const workers = Math.max(1, Math.min(POLL_CONCURRENCY, queue.length));

  async function worker(){
    while (queue.length){
      const cam = queue.shift();
      try {
        const res = await queryCamera0AAE(cam.ip, {
          user: CAM_USER, pass: CAM_PASS, channel: CAM_CHANNEL, secure: CAM_SECURE, timeout: CAM_TIMEOUT_MS
        });
        results.push({ name: cam.name || null, ...res });
      } catch (e){
        results.push({ name: cam.name || null, ip: cam.ip, state:null, stateCode:null, http:null, err: e.message });
      }
    }
  }
  await Promise.all(Array.from({length: workers}, worker));
  lastStatus = results;
  return results;
}
function startPolling(periodMs=POLL_PERIOD_MS){
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(()=>pollOnce().catch(()=>{}), periodMs);
  polling = true;
}


app.get("/api/cameras", (req,res)=> res.json({ cameras }));

app.post("/api/cameras", (req,res)=>{
  const { ips=[], items=[] } = req.body || {};
  const incoming = [
    ...ips.map(ip => ({ ip: String(ip).trim(), name: null })),
    ...items.filter(x=>x && x.ip).map(x => ({ ip: String(x.ip).trim(), name: x.name? String(x.name).trim() : null }))
  ].filter(x=>x.ip);

  const map = new Map(cameras.map(c=>[c.ip, c]));
  for (const it of incoming){
    const prev = map.get(it.ip) || { ip: it.ip, name: null };
    map.set(it.ip, { ip: it.ip, name: it.name ?? prev.name ?? null });
  }
  cameras = Array.from(map.values());
  saveCamerasJson(cameras);
  saveCamerasTxt(cameras);
  res.json({ ok:true, count:cameras.length });
});

app.post("/api/forget", (req,res)=>{
  cameras = [];
  saveCamerasJson(cameras);
  saveCamerasTxt(cameras);
  res.json({ ok:true });
});

app.post("/api/discover", async (req,res)=>{
  const { hosts = VRM_HOSTS } = req.body || {};
  let found = [];
  for (const h of hosts){
    const f = await discoverFromVRM(h, { user: VRM_USER, pass: VRM_PASS, secure: VRM_SECURE });
    found = found.concat(f); // [{ip,name?}]
  }
  const map = new Map(cameras.map(c=>[c.ip, c]));
  for (const it of found){
    const prev = map.get(it.ip) || { ip: it.ip, name: null };
    map.set(it.ip, { ip: it.ip, name: it.name ?? prev.name ?? null });
  }
  cameras = Array.from(map.values());
  saveCamerasJson(cameras);
  saveCamerasTxt(cameras);
  res.json({ ok:true, found: found.length, cameras });
});


app.get("/api/status", async (req,res)=>{
  if (!polling) { pollOnce().catch(()=>{}); }
  res.json({ ts: Date.now(), items: lastStatus || [] });
});

app.post("/api/poll/start", (req,res)=>{
  const { periodMs = POLL_PERIOD_MS } = req.body || {};
  startPolling(periodMs);
  res.json({ ok:true, periodMs });
});

app.post("/api/poll/once", async (req,res)=>{
  const out = await pollOnce();
  res.json({ ok:true, ts: Date.now(), items: out });
});


app.use("/", express.static(path.join(__dirname, "public")));


app.listen(PORT, ()=>{
  console.log(`🚀 Dashboard en http://localhost:${PORT}`);
  console.log(`Cámaras: ${cameras.length} | timeout=${CAM_TIMEOUT_MS}ms | conc=${POLL_CONCURRENCY} | period=${POLL_PERIOD_MS}ms`);
});