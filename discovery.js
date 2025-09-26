
import fetch from "node-fetch";

const uniq = arr => Array.from(new Set(arr));

function extractIPs(text){
  const m = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g);
  return m ? uniq(m) : [];
}

async function tryJsonList(baseUrl, authHeader){
  try {
    const r = await fetch(`${baseUrl}/devices.json`, { headers: authHeader ? { Authorization: authHeader } : undefined });
    if (r.ok) {
      const j = await r.json();
      const flat = JSON.stringify(j);
      const ips = extractIPs(flat);
      return ips.map(ip => ({ ip, name: null }));
    }
  } catch {}
  return [];
}


async function tryRcpDump(baseUrl, authHeader, cmdHex){
  try {
    const url = `${baseUrl}/rcp.xml?command=${cmdHex}&type=P_OCTET&direction=READ`;
    const r = await fetch(url, { headers: authHeader ? { Authorization: authHeader } : undefined });
    if (!r.ok) return [];
    const body = await r.text();

   
    const urls = Array.from(body.matchAll(/https?:\/\/[^\s<"]+/gi)).map(m=>m[0]);
    const urlIPs = uniq(urls.map(u => (u.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)||[])[0]).filter(Boolean));

    
    const m = body.match(/<str>([\s0-9a-fA-F]+)<\/str>/i);
    const pairs = [];
    if (m){
      const hex = m[1].trim().split(/\s+/).map(h=>parseInt(h,16)&0xff);
      
      let s=''; for (let i=0;i+1<hex.length;i+=2){
        const code = hex[i] | (hex[i+1]<<8); s += code ? String.fromCharCode(code) : '\n';
      }
      const parts = s.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      for (let i=0;i<parts.length-2;i++){
        if (/^logical tree$/i.test(parts[i+1]) && /^https?:\/\//i.test(parts[i+2])){
          const ip = (parts[i+2].match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)||[])[0];
          if (ip) pairs.push({ ip, name: parts[i] });
        }
      }
    }

    
    const map = new Map();
    for (const ip of urlIPs) map.set(ip, { ip, name: null });
    for (const p of pairs)  map.set(p.ip, { ip: p.ip, name: p.name });
    return Array.from(map.values());
  } catch { return []; }
}

/**
 * si no anda, revisar esto, en las versiones anteriores solo me traia una camara
 * @returns {Promise<Array<{ip:string, name:string|null}>>}
 */
export async function discoverFromVRM(host, opt={}){
  const { user, pass, secure=true } = opt;
  if (secure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const proto = secure ? "https" : "http";
  const base  = `${proto}://${host}`;
  const auth  = (user && pass) ? "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") : null;

  let out = await tryJsonList(base, auth);
  const cmds = ["0xD007","0xD028","0xD052","0xD05B","0xD060"];
  for (const c of cmds){
    const more = await tryRcpDump(base, auth, c);
    out = out.concat(more);
  }
  const byIp = new Map(out.map(o=>[o.ip, o]));
  return Array.from(byIp.values());
}