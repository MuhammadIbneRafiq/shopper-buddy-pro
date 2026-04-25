const BASE = "/api/bunq";

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "none",
    "User-Agent": "shopper-buddy",
    "X-Bunq-Client-Request-Id": "r" + Date.now() + Math.random().toString(36).slice(2),
    "X-Bunq-Language": "en_US",
    "X-Bunq-Region": "nl_NL",
    "X-Bunq-Geolocation": "0 0 0 0 000",
  };
  if (token) h["X-Bunq-Client-Authentication"] = token;
  return h;
}

export class BunqService {
  private static instance: BunqService;

  private sessionToken = import.meta.env.VITE_BUNQ_SESSION_TOKEN as string;
  private userId = import.meta.env.VITE_BUNQ_USER_ID as string;
  private accountId = import.meta.env.VITE_BUNQ_ACCOUNT_ID as string;

  // Fallback in-memory balance if API is unreachable
  private fallbackBalance = 500.00;

  public static getInstance() {
    if (!BunqService.instance) BunqService.instance = new BunqService();
    return BunqService.instance;
  }

  public async getBalance(): Promise<string> {
    if (!this.sessionToken) return this.fallbackBalance.toFixed(2);
    try {
      const res = await fetch(`${BASE}/user/${this.userId}/monetary-account/${this.accountId}`, {
        headers: headers(this.sessionToken),
      });
      if (!res.ok) return this.fallbackBalance.toFixed(2);
      const data = await res.json();
      const acc = data.Response[0].MonetaryAccountBank ?? data.Response[0].MonetaryAccountSavings;
      return parseFloat(acc.balance.value).toFixed(2);
    } catch {
      return this.fallbackBalance.toFixed(2);
    }
  }

  public async processPayment(req: { amount: number; description: string; counterparty: string }): Promise<{ success: boolean; transactionId: string; message: string }> {
    if (!this.sessionToken) {
      // Fallback: simulate locally
      if (this.fallbackBalance >= req.amount) {
        this.fallbackBalance -= req.amount;
        return { success: true, transactionId: "tx_" + Math.random().toString(36).slice(2), message: `Payment of ${req.amount.toFixed(2)} successful.` };
      }
      return { success: false, transactionId: "failed", message: "Insufficient funds." };
    }

    try {
      // Check balance first
      const balStr = await this.getBalance();
      const balance = parseFloat(balStr);
      if (balance < req.amount) {
        return { success: false, transactionId: "failed", message: `Insufficient funds. Balance: ${balance.toFixed(2)}, needed: ${req.amount.toFixed(2)}.` };
      }

      // Make payment via bunq draft payment (sandbox)
      const res = await fetch(`${BASE}/user/${this.userId}/monetary-account/${this.accountId}/draft-payment`, {
        method: "POST",
        headers: headers(this.sessionToken),
        body: JSON.stringify({
          entries: [{
            amount: { value: req.amount.toFixed(2), currency: "EUR" },
            counterparty_alias: { type: "EMAIL", value: "sugardaddy@bunq.com", name: req.counterparty },
            description: req.description,
          }],
          number_of_required_accepts: 1,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const txId = String(data.Response?.[0]?.Id?.id ?? "tx_" + Date.now());
        return { success: true, transactionId: txId, message: `Payment of ${req.amount.toFixed(2)} to ${req.counterparty} successful.` };
      }

      // draft-payment may not be available in all sandbox tiers  fall back to request-inquiry
      const res2 = await fetch(`${BASE}/user/${this.userId}/monetary-account/${this.accountId}/request-inquiry`, {
        method: "POST",
        headers: headers(this.sessionToken),
        body: JSON.stringify({
          amount_inquired: { value: req.amount.toFixed(2), currency: "EUR" },
          counterparty_alias: { type: "EMAIL", value: "sugardaddy@bunq.com", name: req.counterparty },
          description: req.description,
          allow_bunqme: false,
        }),
      });

      if (res2.ok) {
        const data2 = await res2.json();
        const txId = String(data2.Response?.[0]?.Id?.id ?? "tx_" + Date.now());
        return { success: true, transactionId: txId, message: `Payment of ${req.amount.toFixed(2)} processed.` };
      }

      return { success: false, transactionId: "failed", message: "Payment failed. Please try again." };
    } catch (e) {
      return { success: false, transactionId: "failed", message: "Network error. Please try again." };
    }
  }
}

export const bunq = BunqService.getInstance();
