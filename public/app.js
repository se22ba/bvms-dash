
const $ = s => document.querySelector(s);

const tbody   = $("#tbl tbody");
const tick    = $("#tick");
const progWrap= $("#progress");
const progBar = $("#progress .bar");
const progLbl = $("#progress .label");

async function api(path, opts){
  const r = await fetch(path + (path.includes("?") ? "&" : "?") + "_ts=" + Date.now(), {
    method: opts?.method || "GET",
    headers: { "Content-Type":"application/json", "Cache-Control":"no-store" },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  return r.json();
}

function render(items){
  tbody.innerHTML = "";
  for (const it of (items || [])){
    const cls = (it.state||"").includes("RECORDING") ? "g" : (it.state==="STAND BY" ? "y" : "r");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.name || ""}</td>
      <td>${it.ip}</td>
      <td class="${cls}">${it.state||""}</td>
      <td>${it.stateCode ?? ""}</td>
      <td>${it.recPreset ?? ""}</td>
      <td>${it.encPreset ?? ""}</td>
      <td>${it.flags ?? ""}</td>
      <td>${it.http ?? ""}</td>
      <td>${it.err ?? ""}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function refresh(){
  const j = await api("/api/status");
  render(j.items || []);
  tick.textContent = new Date(j.ts || Date.now()).toLocaleTimeString();
}

$("#addBtn").onclick = async () => {
  const name = $("#nameInput").value.trim();
  const ip   = $("#ipInput").value.trim();
  if (!ip) return;
  await api("/api/cameras", { method:"POST", body:{ items:[{ ip, name: name || null }] } });
  $("#nameInput").value = ""; $("#ipInput").value = "";
  await refresh();
};

async function runDiscoverWithProgress(){
  
  const start = await api("/api/discover/start", { method:"POST" });
  if (!start.ok) return;

  
  progWrap.style.display = "flex";
  progBar.style.width = "0%";
  progLbl.textContent = "0%";

  const id = start.id;
  let stopped = false;

  while (!stopped){
    const st = await api(`/api/discover/status?id=${encodeURIComponent(id)}`);
    if (st && st.ok){
      const pct = st.progress ?? 0;
      const ph  = st.processedHosts ?? 0;
      const th  = st.totalHosts ?? 0;
      progBar.style.width = pct + "%";
      progLbl.textContent = `${pct}% · ${ph}/${th} hosts`;

      if (st.done || st.state === "done" || st.state === "error") {
        stopped = true;
        
        if (st.state === "done" && !st.error) {
          progBar.style.width = "100%";
        } else {
          progLbl.textContent = "error";
        }
      }
    } else {
      
      stopped = true;
    }
    
    await new Promise(r=>setTimeout(r, 700));
  }

  setTimeout(()=>{
    progWrap.style.display = "none";
    progBar.style.width = "0%";
    progLbl.textContent = "";
  }, 450);

  
  await refresh();
}

$("#discoverBtn").onclick = runDiscoverWithProgress;

$("#pollBtn").onclick = async () => {
  await api("/api/poll/once", { method:"POST" });
  await refresh();
};


(async () => {
  await api("/api/poll/start", { method:"POST", body:{ periodMs: 5000 }});
  await refresh();
  setInterval(refresh, 5000);
})();
