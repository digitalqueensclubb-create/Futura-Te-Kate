import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Dashboard privata: /dashboard?key=CHIAVE — mostra solo numeri, mai il contenuto delle conversazioni.

const LABELS: Record<string, string> = {
  visit: "Visite alla pagina",
  start: "Conversazioni iniziate",
  msg: "Messaggi scambiati",
  finish: "Conversazioni arrivate alla fine",
  cta: "Click verso il bot",
  save: "Conversazioni salvate",
};

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const key = Netlify.env.get("DASH_KEY") || "";
  if (!key || url.searchParams.get("key") !== key) return new Response("Accesso non consentito", { status: 403 });

  const store = getStore({ name: "futura-te", consistency: "strong" });
  const { blobs } = (await store.list({ prefix: "ev/" })) as any;
  const tot: Record<string, number> = {};
  const byDay: Record<string, Record<string, number>> = {};
  for (const b of blobs) {
    const [, type, d] = b.key.split("/");
    tot[type] = (tot[type] || 0) + 1;
    byDay[d] = byDay[d] || {};
    byDay[d][type] = (byDay[d][type] || 0) + 1;
  }
  const n = (t: string) => tot[t] || 0;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "—");
  const days = Object.keys(byDay).sort().reverse().slice(0, 21);
  const cols = ["visit", "start", "msg", "finish", "cta"];

  const tiles = cols
    .map((t) => `<div class="t"><b>${n(t)}</b><small>${LABELS[t]}</small></div>`)
    .join("");
  const rows = days.length
    ? days.map((d) => `<tr><td>${new Date(d + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}</td>${cols.map((c) => `<td>${byDay[d][c] || 0}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="6" class="empty">Ancora nessun dato. I numeri compaiono appena qualcuno apre la pagina.</td></tr>`;

  return new Response(
    `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Futura Te · Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#FCEFF5;color:#2A1538;font-family:Manrope,system-ui,sans-serif}
header{background:linear-gradient(150deg,#3B1250,#7A2E7E 55%,#D46A9F);color:#FFF4F8;padding:28px 18px 24px}
header p{margin:0;letter-spacing:.3em;font-size:11px;opacity:.85}
h1{margin:6px 0 16px;font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:34px}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.t{background:rgba(255,255,255,.12);border:1px solid rgba(255,220,236,.35);border-radius:16px;padding:12px 14px}
.t b{display:block;font-family:"Cormorant Garamond",serif;font-size:34px;line-height:1}
.t small{opacity:.9;font-size:12.5px}
main{padding:18px;max-width:900px;margin:0 auto;display:grid;gap:16px}
.card{background:#fff;border:1px solid #F3D3E4;border-radius:18px;padding:16px}
.card h2{margin:0 0 10px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#9A5A86}
.f{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.f div{background:#FCEFF5;border-radius:12px;padding:10px 12px}
.f b{font-size:22px;color:#7A2E7E}
.tw{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:520px;font-size:14px;font-variant-numeric:tabular-nums}
th{text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9A5A86;padding:8px;border-bottom:1px solid #F3D3E4}
td{padding:9px 8px;border-bottom:1px solid #FBE7F0}
.empty{text-align:center;color:#9A5A86;padding:24px}
.note{font-size:12.5px;color:#9A5A86}
</style>
<header><p>✦ FUTURA TE · BY KATE</p><h1>Dashboard</h1><div class="g">${tiles}</div></header>
<main>
<div class="card"><h2>Conversione</h2><div class="f">
<div><b>${pct(n("start"), n("visit"))}</b><br><small>di chi apre la pagina inizia a parlare</small></div>
<div><b>${n("start") ? (n("msg") / n("start")).toFixed(1) : "—"}</b><br><small>messaggi in media per conversazione</small></div>
<div><b>${pct(n("finish"), n("start"))}</b><br><small>arriva alla fine dei 10 minuti</small></div>
<div><b>${pct(n("cta"), n("start"))}</b><br><small>clicca per andare al bot</small></div>
</div></div>
<div class="card"><h2>Giorno per giorno</h2><div class="tw"><table><thead><tr><th>Giorno</th><th>Visite</th><th>Iniziate</th><th>Messaggi</th><th>Finite</th><th>Click bot</th></tr></thead><tbody>${rows}</tbody></table></div></div>
<p class="note">Qui vedi solo numeri. Il contenuto delle conversazioni non viene mai salvato: resta solo sul telefono di chi parla.</p>
</main></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
};

export const config: Config = { path: "/dashboard" };
