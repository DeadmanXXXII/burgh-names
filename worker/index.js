// Cloudflare Worker: direct-to-wallet crypto payments (SOL/BTC/ETH), one-off pricing.
// /quote  -> reserves a name, returns exact amount to send (unique per order)
// /verify -> checks the on-chain payment, then creates the CNAME
const PRICES = { standard: 35, premium: 150 }; // GBP, one-off
const PREMIUM = ["removals","plumber","electrician","roofer","taxi","cafe","joiner","builder","cleaner","gardener","locksmith","rubbish","uplifts","skip","florist","butcher","bakery"];
const ALLOWED_TLDS = ["scot", "wales", "uk", "ie"];
const RESERVED = ["gov", "org", "nhs", "police", "mod", "parliament", "ac", "sch", "co", "com", "net", "ltd", "plc", "me", "edu", "mil", "army", "navy", "bank", "hmrc", "council", "court", "ambulance", "fire", "post", "mail", "admin", "www", "dwp", "dvla", "hse", "garda", "charity", "registry"];
// Names: no reserved word as any hyphen-separated part, nothing that starts with "gov", no hmrc/nhs lookalikes.
const nameAllowed = n => !n.split("-").some(t => RESERVED.includes(t)) && !n.startsWith("gov") && !/hmrc|nhs|govuk/.test(n);
// Zones: exactly label.tld, tld on the allowlist (so never .org, .gov.uk, .org.uk, .co.uk, .nhs.uk...), label not reserved.
const zoneAllowed = z => { const p = z.split("."); return p.length === 2 && ALLOWED_TLDS.includes(p[1]) && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(p[0]) && nameAllowed(p[0]); };
const CHAINS = {
  SOL: { cg: "solana",   dec: 9,  off: () => BigInt(1 + Math.floor(Math.random() * 200000)) },
  BTC: { cg: "bitcoin",  dec: 8,  off: () => BigInt(1 + Math.floor(Math.random() * 2000)) },
  ETH: { cg: "ethereum", dec: 18, off: () => BigInt(1e9) + BigInt(Math.floor(Math.random() * 1e12)) }
};
const TERMS_VERSION = "2026-10-11";
const QUOTE_MS = 30 * 60 * 1000;
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...h } });

function validate(env, { name, zone, target }) {
  const zones = JSON.parse(env.ZONES);
  if (!zones[zone] || !zoneAllowed(zone)) return "Unknown place";
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(name || "")) return "Invalid name";
  if (!nameAllowed(name)) return "Reserved name";
  if (!/^[a-z0-9-]+\.github\.io$/.test(target || "")) return "Target must be a github.io address";
  return null;
}
async function cf(env, path, init = {}) {
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, { ...init, headers: { Authorization: "Bearer " + env.CF_API_TOKEN, "Content-Type": "application/json" } });
  return r.json();
}
async function taken(env, zone, name) {
  const id = JSON.parse(env.ZONES)[zone];
  const r = await cf(env, `/zones/${id}/dns_records?name=${name}.${zone}`);
  return !r.success || r.result.length > 0; // fail closed
}
const fmt = (u, d) => { const s = u.toString().padStart(d + 1, "0"); return (s.slice(0, -d) + "." + s.slice(-d)).replace(/0+$/, "").replace(/\.$/, ""); };
async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await r.json()).result;
}

async function verifyBTC(env, o, txid) {
  const r = await fetch(`https://mempool.space/api/tx/${txid}`);
  if (!r.ok) return "Transaction not found yet";
  const t = await r.json();
  if (!t.status.confirmed) return "Waiting for 1 confirmation. Try again shortly";
  if (t.status.block_time * 1000 < o.created) return "That payment is older than this order";
  const ok = t.vout.some(v => v.scriptpubkey_address === env.ADDR_BTC && BigInt(v.value) === BigInt(o.amount));
  return ok ? null : "No payment of the exact amount to our address";
}
async function verifyETH(env, o, txid) {
  const [tx, rec] = await Promise.all([rpc(env.ETH_RPC, "eth_getTransactionByHash", [txid]), rpc(env.ETH_RPC, "eth_getTransactionReceipt", [txid])]);
  if (!tx || !rec) return "Transaction not found yet";
  if (rec.status !== "0x1") return "Transaction failed on-chain";
  if ((tx.to || "").toLowerCase() !== env.ADDR_ETH.toLowerCase() || BigInt(tx.value) !== BigInt(o.amount)) return "No payment of the exact amount to our address";
  const head = await rpc(env.ETH_RPC, "eth_blockNumber", []);
  if (BigInt(head) - BigInt(rec.blockNumber) < 2n) return "Waiting for confirmations. Try again shortly";
  const blk = await rpc(env.ETH_RPC, "eth_getBlockByNumber", [rec.blockNumber, false]);
  return parseInt(blk.timestamp, 16) * 1000 < o.created ? "That payment is older than this order" : null;
}
async function verifySOL(env, o, sig) {
  const t = await rpc(env.SOL_RPC, "getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" }]);
  if (!t) return "Transaction not found or not finalized yet. Try again shortly";
  if (t.meta && t.meta.err) return "Transaction failed on-chain";
  if (t.blockTime * 1000 < o.created) return "That payment is older than this order";
  const ok = t.transaction.message.instructions.some(i => i.program === "system" && i.parsed && i.parsed.type === "transfer" &&
    i.parsed.info.destination === env.ADDR_SOL && BigInt(i.parsed.info.lamports) === BigInt(o.amount));
  return ok ? null : "No payment of the exact amount to our address";
}
const TXRE = { BTC: /^[0-9a-fA-F]{64}$/, ETH: /^0x[0-9a-fA-F]{64}$/, SOL: /^[1-9A-HJ-NP-Za-km-z]{80,90}$/ };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN, "Access-Control-Allow-Headers": "Content-Type" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method === "GET" && url.pathname === "/zones") return json({ zones: Object.keys(JSON.parse(env.ZONES)).filter(zoneAllowed) }, 200, cors);
    if (req.method !== "POST") return json({ error: "not found" }, 404, cors);
    const b = await req.json().catch(() => ({}));

    if (url.pathname === "/quote") {
      const err = validate(env, b);
      if (err) return json({ error: err }, 400, cors);
      if (b.agreed !== true || b.terms !== TERMS_VERSION) return json({ error: "Please accept the terms and acceptable use policy" }, 400, cors);
      const ch = CHAINS[b.chain];
      if (!ch) return json({ error: "Unknown coin" }, 400, cors);
      const fqdn = `${b.name}.${b.zone}`;
      if (await taken(env, b.zone, b.name)) return json({ error: "That name is already taken" }, 409, cors);
      if (await env.KV.get("res:" + fqdn)) return json({ error: "Someone is paying for that name right now. Try again in 30 minutes" }, 409, cors);
      const tier = PREMIUM.includes(b.name) ? "premium" : "standard";
      const pr = await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ch.cg}&vs_currencies=gbp`)).json();
      const rate = pr[ch.cg] && pr[ch.cg].gbp;
      if (!rate) return json({ error: "Price feed unavailable. Try again" }, 502, cors);
      const base = BigInt(Math.round((PRICES[tier] / rate) * 10 ** ch.dec));
      let amount;
      for (let i = 0; i < 10 && !amount; i++) {
        const a = base + ch.off(), k = `amt:${b.chain}:${a}`;
        if (!(await env.KV.get(k))) { await env.KV.put(k, "1", { expirationTtl: 3600 }); amount = a; }
      }
      if (!amount) return json({ error: "Busy. Try again" }, 503, cors);
      const id = crypto.randomUUID(), created = Date.now();
      const address = env["ADDR_" + b.chain], text = fmt(amount, ch.dec);
      await env.KV.put("order:" + id, JSON.stringify({ name: b.name, zone: b.zone, target: b.target, chain: b.chain, amount: amount.toString(), created, terms: TERMS_VERSION }), { expirationTtl: 3600 });
      await env.KV.put("res:" + fqdn, id, { expirationTtl: 1800 });
      const uri = b.chain === "BTC" ? `bitcoin:${address}?amount=${text}` : b.chain === "ETH" ? `ethereum:${address}?value=${amount}` : `solana:${address}?amount=${text}`;
      return json({ orderId: id, address, amountText: text, uri, price: PRICES[tier], expires: created + QUOTE_MS }, 200, cors);
    }

    if (url.pathname === "/verify") {
      const raw = await env.KV.get("order:" + b.orderId);
      if (!raw) return json({ error: "Order expired. Start again" }, 404, cors);
      const o = JSON.parse(raw);
      if (await env.KV.get("done:" + b.orderId)) return json({ ok: true, fqdn: `${o.name}.${o.zone}` }, 200, cors);
      const txid = String(b.txid || "").trim();
      if (!TXRE[o.chain].test(txid)) return json({ error: "That doesn't look like a transaction ID" }, 400, cors);
      if (await env.KV.get(`tx:${o.chain}:${txid.toLowerCase()}`)) return json({ error: "That transaction was already used" }, 409, cors);
      if (Date.now() > o.created + 3 * 3600 * 1000) return json({ error: "Order expired" }, 410, cors);
      const v = { BTC: verifyBTC, ETH: verifyETH, SOL: verifySOL }[o.chain];
      const problem = await v(env, o, txid).catch(() => "Could not reach the network. Try again");
      if (problem) return json({ error: problem }, 402, cors);
      await env.KV.put(`tx:${o.chain}:${txid.toLowerCase()}`, b.orderId);
      if (validate(env, o) || await taken(env, o.zone, o.name)) return json({ error: "Paid, but the name is no longer available. Contact us with your transaction ID" }, 409, cors);
      const out = await cf(env, `/zones/${JSON.parse(env.ZONES)[o.zone]}/dns_records`, {
        method: "POST",
        body: JSON.stringify({ type: "CNAME", name: o.name, content: o.target, proxied: false, ttl: 300, comment: `BurghNames ${o.chain} ${txid.slice(0, 16)}` })
      });
      if (!out.success) return json({ error: "Paid, but DNS setup failed. Contact us with your transaction ID" }, 500, cors);
      await env.KV.put("done:" + b.orderId, "1");
      return json({ ok: true, fqdn: `${o.name}.${o.zone}` }, 200, cors);
    }
    return json({ error: "not found" }, 404, cors);
  }
};
