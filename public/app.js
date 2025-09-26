const $ = s => document.querySelector(s);
const tbody = $("#tbl tbody");
const tick = $("#tick");

async function api(path, opts){
  const r = await fetch(path, { method: opts?.method || "GET", headers: { "Content-Type":"application/json" }, body: opts?.body ? JSON.stringify(opts.body) : undefined });
  return r.json();
}

function render(items){
  tbody.innerHTML = "";
  for (const it of items){
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

$("#discoverBtn").onclick = async () => {
  await api("/api/discover", { method:"POST" });
  await refresh();
};

$("#pollBtn").onclick = async () => {
  await api("/api/poll/once", { method:"POST" });
  await refresh();
};

(async () => {
  await api("/api/poll/start", { method:"POST", body:{ periodMs: 5000 }});
  await refresh();
  setInterval(refresh, 5000);
})();