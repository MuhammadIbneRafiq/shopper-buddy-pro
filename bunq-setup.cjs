const crypto = require("crypto");
const BUNQ_API_KEY = "sandbox_9a49c4c3b4461951a4f63012f1817e40c18f658f4d322372a4111b34";
const BASE = "https://public-api.sandbox.bunq.com/v1";

function h(token) {
  const headers = {
    "Content-Type": "application/json", "Cache-Control": "none",
    "User-Agent": "shopper-buddy", "X-Bunq-Client-Request-Id": "r" + Date.now(),
    "X-Bunq-Language": "en_US", "X-Bunq-Region": "nl_NL", "X-Bunq-Geolocation": "0 0 0 0 000",
  };
  if (token) headers["X-Bunq-Client-Authentication"] = token;
  return headers;
}

async function run() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const i = await (await fetch(`${BASE}/installation`, { method: "POST", headers: h(), body: JSON.stringify({ client_public_key: publicKey }) })).json();
  const installToken = i.Response[1].Token.token;

  await fetch(`${BASE}/device-server`, { method: "POST", headers: h(installToken), body: JSON.stringify({ description: "shopper-buddy", secret: BUNQ_API_KEY, permitted_ips: ["*"] }) });

  const s = await (await fetch(`${BASE}/session-server`, { method: "POST", headers: h(installToken), body: JSON.stringify({ secret: BUNQ_API_KEY }) })).json();
  const sessionToken = s.Response[1].Token.token;
  const userId = s.Response[2].UserPerson?.id ?? s.Response[2].UserApiKey?.id;

  const a = await (await fetch(`${BASE}/user/${userId}/monetary-account`, { headers: h(sessionToken) })).json();
  const acc = a.Response[0].MonetaryAccountBank ?? a.Response[0].MonetaryAccountSavings;
  const accountId = acc.id;

  // Fund with sugar daddy
  await fetch(`${BASE}/user/${userId}/monetary-account/${accountId}/request-inquiry`, {
    method: "POST", headers: h(sessionToken),
    body: JSON.stringify({ amount_inquired: { currency: "EUR", value: "500.00" }, counterparty_alias: { type: "EMAIL", value: "sugardaddy@bunq.com", name: "Sugar Daddy" }, description: "Sandbox funds", allow_bunqme: false })
  });

  // Seed grocery transactions
  for (const [merchant, amount] of [["Albert Heijn", "23.46"], ["Lidl", "18.20"], ["Jumbo", "31.05"], ["Aldi", "14.30"]]) {
    await fetch(`${BASE}/user/${userId}/monetary-account/${accountId}/request-inquiry`, {
      method: "POST", headers: h(sessionToken),
      body: JSON.stringify({ amount_inquired: { currency: "EUR", value: amount }, counterparty_alias: { type: "EMAIL", value: "sugardaddy@bunq.com", name: "Sugar Daddy" }, description: merchant, allow_bunqme: false })
    });
  }

  console.log(`SESSION=${sessionToken}`);
  console.log(`USER=${userId}`);
  console.log(`ACCOUNT=${accountId}`);
}

run().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
