
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


const PORT        = parseInt(process.env.PORT || "8080", 10);
const CAM_USER    = process.env.CAM_USER || "";
const CAM_PASS    = process.env.CAM_PASS || "";
const CAM_CHANNEL = parseInt(process.env.CAM_CHANNEL || "1", 10);
const CAM_SECURE  = String(process.env.CAM_SECURE||"false").toLowerCase()==="true";
const VRM_HOSTS   = (process.env.VRM_HOSTS || "").split(",").map(s=>s.trim()).filter(Boolean);
const VRM_USER    = process.env.VRM_USER || "";
const VRM_PASS    = process.env.VRM_PASS || "";
const VRM_SECURE  = String(process.env.VRM_USE_HTTPS||"true").toLowerCase()==="true";

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CAM_TXT  = path.join(DATA_DIR, "cameras.txt");
const CAM_JSON = path.join(DATA_DIR, "cameras.json");


function parseLine(line){
  
  const t = line.trim();
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
  const results = [];
  for (const cam of cameras){
    const res = await queryCamera0AAE(cam.ip, {
      user: CAM_USER, pass: CAM_PASS, channel: CAM_CHANNEL, secure: CAM_SECURE, timeout: 5000
    });
    results.push({ name: cam.name || null, ...res });
    await new Promise(r=>setTimeout(r, 120));
  }
  lastStatus = results;
  return results;
}
function startPolling(periodMs=5000){
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
    found = found.concat(f); 
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
  if (!polling) await pollOnce();
  res.json({ ts: Date.now(), items: lastStatus });
});

app.post("/api/poll/start", (req,res)=>{
  const { periodMs = 5000 } = req.body || {};
  startPolling(periodMs);
  res.json({ ok:true, periodMs });
});

app.post("/api/poll/once", async (req,res)=>{
  const out = await pollOnce();
  res.json({ ok:true, ts: Date.now(), items: out });
});


app.use("/", express.static(path.join(__dirname, "public")));

app.listen(PORT, ()=>{
  console.log(` Dashboard en http://localhost:${PORT}`);
  console.log(`Cámaras: ${cameras.length}`);
});