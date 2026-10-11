# BurghNames: UK domain generator

Type a name, see it under every place (`name.ayrshire.scot`, `name.london.uk`, `name.pontapandy.wales`...), pay once in SOL/BTC/ETH to your wallets, and the name is pointed at the customer's GitHub Pages site.

## How the catalogue works
- `site/places.json` lists every place: `{label, name, nation, tld}`. The address is `<name>.<label>.<tld>`. Add England's remaining local authorities from the official ONS list.
- A place only goes **live** when its zone appears in `ZONES` in `worker/wrangler.toml`. Everything else shows "Opening soon". The site asks the Worker (`GET /zones`).

## Opening a new place
1. Register the parent domain (e.g. `camden.uk`) with a registrar. Check registry eligibility rules for `.scot` and `.wales` first.
2. Add it to Cloudflare, point the registrar's nameservers there, copy the Zone ID.
3. Add `"camden.uk":"<zone id>"` to `ZONES`, then `npx wrangler deploy`. It's live on the site immediately.
Each place costs a domain registration and renewal, so open places as demand shows up.

## Setup
1. Cloudflare API token: Zone > DNS > Edit, limited to your zones.
2. `cd worker && npx wrangler kv namespace create burgh-names`, paste the id into `wrangler.toml`.
3. `npx wrangler secret put CF_API_TOKEN`, `npx wrangler deploy`.
4. Put the Worker URL in `site/config.js`. Push to GitHub, Settings > Pages > Source: GitHub Actions.
5. Test with a tiny real payment first.

## Payments
Direct to your wallets, one-off. `/quote` fixes the GBP price as an exact coin amount; `/verify` checks the transaction on-chain, then creates the CNAME. See `worker/index.js`.

## Before selling
Terms (one-off covers the name while the service operates; no refunds; abusive names removed), tax advice for crypto receipts, and a Public Suffix List application per parent zone so customers are isolated from each other.

## Safety rules (blocklist)
`rules.json` is the source of truth. Enforced in three places: the Worker (authoritative, rejects at quote and verify and hides zones from `/zones`), the site, and a CI check that fails the deploy if the catalogue, `ZONES` or the code drift from it.
- Only these extensions can be sold: `.scot`, `.wales`, `.uk`, `.ie`. So `.org`, `.gov.uk`, `.org.uk`, `.nhs.uk`, `.police.uk`, `.gov.scot` and similar can never be zones.
- Names and place labels can't contain reserved words (gov, org, nhs, police, council, bank, hmrc and more) as any hyphen-separated part, or start with "gov".
- Targets must be `github.io`. Keep removing abusive names promptly and add a takedown route.

## About .ni and .roi
`.ni` is Nicaragua's country extension and `.roi` doesn't exist, so `belfast.ni` and `cork.roi` can't be sold. Use `belfast.uk` (already in the catalogue) and `cork.ie` (added, with other Irish counties).

## Terms and takedown
- `site/terms.html` is the acceptable use policy and terms. Fill in the `[[...]]` placeholders (operator name, address, contact email, governing law). The deploy check fails until you do. Have a solicitor review it: UK consumer law limits what you can exclude, and the page says so.
- Buyers must tick the acceptance box; the Worker rejects quotes without it and stores the terms version with each order.
- To remove a name immediately: Actions > "Takedown a name" > enter the full name and a reason. Needs secrets `CF_API_TOKEN` and `CF_ZONES_JSON` (`{"ayrshire.scot":"<zone id>"}`). Note a removed name can be bought again unless you add it to a ban list.
