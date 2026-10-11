// Edit this file only. Places are listed in places.json; zones you have actually registered
// and wired into the Worker (ZONES in wrangler.toml) are the ones that go "live" on the site.
window.BURGH = {
  brand: "BurghNames",
  workerUrl: "https://burgh-names.YOUR-SUBDOMAIN.workers.dev",
  chains: ["SOL","BTC","ETH"],
  prices: { standard: 35, premium: 150 },   // GBP one-off; must match worker/index.js
  premiumWords: ["removals","plumber","electrician","roofer","taxi","cafe","joiner","builder","cleaner","gardener","locksmith","rubbish","uplifts","skip","florist","butcher","bakery"],
  allowedTlds: ["scot", "wales", "uk", "ie"],
  reserved: ["gov", "org", "nhs", "police", "mod", "parliament", "ac", "sch", "co", "com", "net", "ltd", "plc", "me", "edu", "mil", "army", "navy", "bank", "hmrc", "council", "court", "ambulance", "fire", "post", "mail", "admin", "www", "dwp", "dvla", "hse", "garda", "charity", "registry"]
};
