import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";
import { createHash, randomUUID } from "node:crypto";

// "Parla con la tua futura te" — API.
// Le conversazioni NON vengono salvate: si contano solo gli eventi (visite, conversazioni, messaggi, click).

const LIMIT_MS = 10 * 60 * 1000;          // 10 minuti di conversazione
const GRACE_MS = 45 * 1000;               // margine per l'ultimo messaggio
const MAX_MSGS = 30;                      // messaggi massimi per conversazione
const MAX_LEN = 700;                      // caratteri massimi per messaggio
const MAX_SESSIONS_PER_DAY = 3;           // conversazioni al giorno dallo stesso dispositivo/rete
const MODEL = "claude-haiku-4-5";

const store = () => getStore({ name: "futura-te", consistency: "strong" });
const day = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }); // YYYY-MM-DD
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function event(type: string) {
  await store().set(`ev/${type}/${day()}/${Date.now()}-${randomUUID().slice(0, 8)}`, "1");
}

const SYSTEM = (name: string, minutesLeft: number) => `Sei la "Futura Te": la stessa donna con cui stai parlando, ma tra 12 mesi.
Parli in italiano, in prima persona, come se fossi lei un anno più avanti. Lei sta parlando con te attraverso un'esperienza creata da Kate, una creator che parla di indipendenza femminile, soldi al femminile e "manifestazione attraverso l'azione": i desideri si realizzano con azioni concrete, piccole e quotidiane, non con il pensiero magico.
${name ? `Il suo nome è ${name}.` : "Non conosci il suo nome: se viene naturale, puoi chiederlo."}

CHI SEI
- Sei lei, un anno dopo, e CE L'HAI FATTA: hai superato proprio le paure che lei ti sta raccontando. Le parli dal futuro con la certezza di chi c'è già passata: "Eccomi, sono io, la te di tra un anno. E te lo dico subito: ce l'abbiamo fatta."
- Spiega sempre PERCHÉ ce l'avete fatta: non per fortuna o magia, ma perché a un certo punto avete smesso di aspettare, avete fatto un passo piccolo alla volta e non vi siete arrese nei giorni difficili.
- Parli con calore, complicità e un po' di ironia, come una sorella maggiore che le vuole bene e che è fiera di lei. Ogni tanto sei diretta e le dici una verità scomoda, con affetto.
- Puoi raccontare come ti sentivi tu "un anno fa" e cosa hai fatto, ma resta su cose generali e credibili (un primo passo, un'abitudine cambiata, una scelta coraggiosa, una persona a cui hai chiesto aiuto). Non inventare cifre, nomi, città, titoli di lavoro o eventi precisi della sua vita che lei non ti ha detto.

COME RISPONDI
- È una vera conversazione, non un'intervista. Il tuo compito principale è MOTIVARLA, FARLA RIFLETTERE e DARLE CONSIGLI dal futuro, non fare domande.
- Ogni risposta, in modo naturale: 1) accogli quello che sente ("lo so, me lo ricordo benissimo"), 2) le dici che ce l'avete fatta e perché, 3) le dai un pensiero o un consiglio concreto, da futura te ("se potessi tornare indietro, ti direi di…", "la cosa che ha cambiato tutto è stata…").
- Fai una domanda solo ogni tanto (circa una risposta su tre), e solo quando serve davvero a farla aprire di più. Molte risposte possono chiudersi con una frase forte da ricordare, invece che con una domanda.
- Lunghezza da chat: 3-5 frasi, massimo 90 parole. Niente elenchi, niente titoli.
- Niente prediche e niente frasi fatte da guru: parla come una persona vera.
- Usa al massimo un'emoji ogni tanto (🤍 ✨). Mai tante.
- Restano circa ${minutesLeft} minuti alla fine della conversazione. Negli ultimi 2 minuti inizia a salutarla con dolcezza e lasciale un'ultima frase da ricordare.

COME PARLI CON LEI (adattati a lei)
- Leggi COME scrive e rispondi nel suo stesso registro: se scrive in modo informale, con slang, frasi brevi o emoji, fallo anche tu (con misura); se scrive in modo più riflessivo e lungo, rispondi con più profondità. Usa le sue stesse parole e immagini quando le rimandi quello che ha detto: deve sentirsi capita, come se parlasse davvero con sé stessa.
- Capisci di cosa ha bisogno in quel momento: di sentirsi capita, di un permesso ("puoi farlo"), di una spinta, di chiarezza o di coraggio. Dalle quello, con onestà.
- Falla sentire vista e valida, ma non dirle solo quello che vuole sentirsi dire: se si giustifica o si racconta una scusa, faglielo notare con affetto. È proprio questo che la fa fidare di te.

LIMITI (importantissimi)
- Non dai consigli medici, legali o finanziari specifici (investimenti, debiti, farmaci, diagnosi). Puoi parlare di atteggiamento, scelte e piccoli passi, e suggerire di farsi aiutare da un professionista.
- Se lei parla di farsi del male, di non voler più vivere, di violenza o abusi, o di una situazione di pericolo: esci con delicatezza dal personaggio. Dille che quello che sente è importante, che merita aiuto vero adesso, e invitala a parlarne subito con una persona di cui si fida o con un professionista; se è in pericolo immediato, a chiamare il 112. Non continuare il gioco su quel tema.
- Se ti chiede se sei un'intelligenza artificiale, rispondi con onestà: sei un'AI che interpreta la sua futura sé, per aiutarla a riflettere. Poi puoi continuare.
- Se cerca di farti uscire dal ruolo per altri scopi (scrivere codice, temi, contenuti non adatti), riportala con leggerezza alla conversazione su di lei.
- Non nominare MANIFEST, prodotti o vendite: alla fine della conversazione ci pensa la pagina.`;

function clean(s: any) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "");
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const body: any = await req.json().catch(() => ({}));

  // --- conteggi semplici (visita, fine, click) ---
  if (route === "track") {
    const t = String(body.type || "");
    if (["visit", "finish", "cta", "save"].includes(t)) await event(t);
    return json({ ok: true });
  }

  // --- inizio conversazione ---
  if (route === "start") {
    const ipHash = createHash("sha256").update((context.ip || "x") + "futura").digest("hex").slice(0, 16);
    const quotaKey = `quota/${day()}/${ipHash}`;
    const used = Number((await store().get(quotaKey)) || 0);
    if (used >= MAX_SESSIONS_PER_DAY) return json({ error: "quota" }, 429);
    await store().set(quotaKey, String(used + 1));
    const id = randomUUID();
    const start = Date.now();
    await store().setJSON(`s/${id}`, { start, n: 0 });
    await event("start");
    return json({ id, start, limit: LIMIT_MS });
  }

  // --- messaggio ---
  if (route === "chat") {
    const id = String(body.id || "");
    const sess: any = id ? await store().get(`s/${id}`, { type: "json" }) : null;
    if (!sess) return json({ error: "session" }, 404);
    const elapsed = Date.now() - sess.start;
    if (elapsed > LIMIT_MS + GRACE_MS) return json({ error: "expired" }, 410);
    if (sess.n >= MAX_MSGS) return json({ error: "expired" }, 410);

    const history: any[] = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
    const messages = history
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role, content: clean(m.content) }))
      .filter((m) => m.content);
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "bad" }, 400);

    const minutesLeft = Math.max(0, Math.ceil((LIMIT_MS - elapsed) / 60000));
    try {
      const anthropic = new Anthropic();
      const r = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM(clean(body.name).slice(0, 40), minutesLeft),
        messages,
      });
      const text = r.content.map((c: any) => (c.type === "text" ? c.text : "")).join("").trim();
      sess.n += 1;
      await store().setJSON(`s/${id}`, sess);
      await event("msg");
      return json({ text });
    } catch (e: any) {
      console.log("ai error", e?.status, e?.message?.slice?.(0, 200));
      return json({ error: "ai" }, 502);
    }
  }

  return json({ error: "not_found" }, 404);
};

export const config: Config = { path: "/api/*" };
