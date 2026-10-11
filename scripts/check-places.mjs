// CI guard: fails the deploy if the catalogue, config or Worker drift from rules.json.
import { readFileSync } from "node:fs";
const rules = JSON.parse(readFileSync("rules.json", "utf8"));
const places = JSON.parse(readFileSync("site/places.json", "utf8"));
const worker = readFileSync("worker/index.js", "utf8");
const config = readFileSync("site/config.js", "utf8");
const toml = readFileSync("worker/wrangler.toml", "utf8");
const errs = [];
const seen = new Set();
const bad = n => n.split("-").some(t => rules.reserved.includes(t)) || n.startsWith("gov") || /hmrc|nhs|govuk/.test(n);
for (const p of places) {
  const z = `${p.label}.${p.tld}`;
  if (!rules.allowedTlds.includes(p.tld)) errs.push(`${z}: extension not allowed`);
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])$/.test(p.label)) errs.push(`${z}: bad label`);
  if (bad(p.label)) errs.push(`${z}: reserved label`);
  if (seen.has(z)) errs.push(`${z}: duplicate`);
  seen.add(z);
}
const m = toml.match(/^ZONES\s*=\s*'(.*)'/m);
if (m) for (const z of Object.keys(JSON.parse(m[1]))) {
  const [l, t, ...rest] = z.split(".");
  if (rest.length || !rules.allowedTlds.includes(t) || bad(l)) errs.push(`ZONES: ${z} not allowed`);
}
for (const w of rules.reserved) for (const [f, t] of [["worker/index.js", worker], ["site/config.js", config]])
  if (!t.includes(`"${w}"`)) errs.push(`${f} is missing reserved word "${w}"`);
for (const t of rules.allowedTlds) for (const [f, x] of [["worker/index.js", worker], ["site/config.js", config]])
  if (!x.includes(`"${t}"`)) errs.push(`${f} is missing extension "${t}"`);
const terms = readFileSync("site/terms.html", "utf8");
const ph = terms.match(/\[\[[^\]]+\]\]/g);
if (ph) errs.push("terms.html still has placeholders to fill in: " + [...new Set(ph)].join(", "));
if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
console.log(`OK: ${places.length} places, rules in sync`);
