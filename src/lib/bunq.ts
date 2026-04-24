/**
 * Bunq API Service (Sandbox / Memory / Dummy)
 */

interface BunqPaymentRequest {
    amount: number;
    description: string;
    counterparty: string;
}

export class BunqService {
    private static instance: BunqService;
    private balance: number = 500.00; // Starting sandbox balance
    private apiKey: string | null = null;

    private constructor() {
        this.apiKey = import.meta.env.VITE_BUNQ_API_KEY || null;
    }

    public static getInstance() {
        if (!BunqService.instance) {
            BunqService.instance = new BunqService();
        }
        return BunqService.instance;
    }

    public getBalance(): string {
        return this.balance.toFixed(2);
    }

    public async processPayment(req: BunqPaymentRequest): Promise<{ success: boolean; transactionId: string; message: string }> {
        // Simulate API latency
        await new Promise(r => setTimeout(r, 1500));

        if (this.balance >= req.amount) {
            this.balance -= req.amount;
            const txId = "tx_" + Math.random().toString(36).substring(7);
            return {
                success: true,
                transactionId: txId,
                message: `Payment of €${req.amount.toFixed(2)} to ${req.counterparty} successful.`
            };
        } else {
            return {
                success: false,
                transactionId: "failed",
                message: "Insufficient funds in your bunq account."
            };
        }
    }
}

export const bunq = BunqService.getInstance();
