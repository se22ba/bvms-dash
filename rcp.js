
import fetch from "node-fetch";

export function mapRecState(code){
  const states = [
    "OFF",
    "NO RECORDING",
    "STAND BY",
    "PRE ALARM RECORDING",
    "ALARM RECORDING",
    "POST ALARM RECORDING"
  ];
  return states[code] ?? `UNKNOWN(${code})`;
}

function extract(tag, xml){
  const m = String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
}
function decodeHexStr(str){
  return str.trim().split(/\s+/).filter(Boolean).map(h => parseInt(h,16) & 0xff);
}

/**
 * @param {string} ip
 * @param {{user:string, pass:string, channel?:number, secure?:boolean, timeout?:number}} opt
 */
export async function queryCamera0AAE(ip, opt={}){
  const { user, pass, channel=1, secure=false, timeout=5000 } = opt;

  if (secure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const proto = secure ? "https" : "http";
  const url = `${proto}://${ip}/rcp.xml?command=0x0aae&type=P_OCTET&direction=READ&num=${channel}`;
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeout);

  try {
    const r = await fetch(url, { headers: { Authorization: auth }, signal: controller.signal });
    const body = await r.text();
    const err  = extract("err", body);
    const str  = extract("str", body);
    const status = r.status;

    if (!str){
      return { ip, state:null, stateCode:null, recPreset:null, encPreset:null, flags:null, http:status, err: err || "no <str>", url };
    }
    const b = decodeHexStr(str);
    const stateCode = b[0] ?? null;
    return {
      ip,
      stateCode,
      state: stateCode!=null ? mapRecState(stateCode) : null,
      recPreset: b[1] ?? null,
      encPreset: b[2] ?? null,
      flags:     b[3] ?? null,
      http: status,
      err: err || null,
      url
    };
  } catch (e){
    return { ip, state:null, stateCode:null, recPreset:null, encPreset:null, flags:null, http:null, err: e.name==="AbortError" ? "timeout" : e.message, url: null };
  } finally {
    clearTimeout(t);
  }
}