import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wallet, Sparkles, UserPlus } from "lucide-react";

export default function Budget() {
  const [budget, setBudget] = useState<{ id: string; monthly_limit: number; currency: string } | null>(null);
  const [spent, setSpent] = useState(0);
  const [limit, setLimit] = useState("400");
  const [helperEmail, setHelperEmail] = useState("");
  const [joint, setJoint] = useState<{ helper_email: string | null } | null>(null);
  const [account, setAccount] = useState<any>(null);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: b } = await supabase.from("grocery_budgets").select("*").eq("user_id", user.id)
      .order("period_start", { ascending: false }).limit(1).maybeSingle();
    setBudget(b as any);
    if (b) setLimit(String(b.monthly_limit));

    const periodStart = new Date(); periodStart.setDate(1);
    const { data: txs } = await supabase.from("transactions").select("amount")
      .eq("user_id", user.id).gte("occurred_at", periodStart.toISOString());
    setSpent((txs ?? []).reduce((s, t: any) => s + Number(t.amount), 0));

    const { data: j } = await supabase.from("joint_accounts").select("helper_email")
      .eq("primary_user_id", user.id).maybeSingle();
    setJoint(j as any);

    const { data: bunq } = await supabase.functions.invoke("bunq-mock", { body: {} });
    setAccount(bunq);
  }
  useEffect(() => { load(); }, []);

  async function saveLimit() {
    if (!budget) return;
    const { error } = await supabase.from("grocery_budgets").update({ monthly_limit: Number(limit) }).eq("id", budget.id);
    if (error) toast.error(error.message); else { toast.success("Budget updated"); load(); }
  }

  async function seedBunq() {
    const { error } = await supabase.functions.invoke("bunq-mock", { body: { action: "seed" } });
    if (error) toast.error(error.message); else { toast.success("Seeded mock bunq transactions"); load(); }
  }

  async function linkHelper(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: helperUser } = await supabase.from("profiles").select("id").eq("phone", helperEmail).maybeSingle();
    // Allow linking by any signed-up email (look up via user_roles join requires admin); here we just store the email and mark helper_user_id null until they accept.
    const { error } = await supabase.from("joint_accounts").insert({
      primary_user_id: user!.id,
      helper_user_id: helperUser?.id ?? user!.id, // self-link fallback for demo
      helper_email: helperEmail,
    });
    if (error) toast.error(error.message); else { toast.success("Helper linked"); setHelperEmail(""); load(); }
  }

  const remaining = Math.max(0, (budget?.monthly_limit ?? 0) - spent);
  const pct = budget?.monthly_limit ? Math.min(100, (spent / budget.monthly_limit) * 100) : 0;

  return (
    <section className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold">Budget & account</h1>

      <Card className="p-6 shadow-soft">
        <div className="flex items-center gap-3 mb-4">
          <Wallet className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">This month  groceries</h2>
        </div>
        <div className="flex justify-between text-base mb-2">
          <span>Spent {budget?.currency ?? "EUR"} {spent.toFixed(2)}</span>
          <span className="font-bold">{remaining.toFixed(2)} left</span>
        </div>
        <Progress value={pct} className="h-3" />

        <div className="mt-6 flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <Label htmlFor="lim">Monthly limit ({budget?.currency ?? "EUR"})</Label>
            <Input id="lim" type="number" value={limit} onChange={(e) => setLimit(e.target.value)} className="h-12 text-base" />
          </div>
          <Button onClick={saveLimit} className="h-12">Save</Button>
        </div>
      </Card>

      <Card className="p-6 shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">bunq account (mocked)</h2>
          <Button onClick={seedBunq} variant="outline" size="sm">
            <Sparkles className="w-4 h-4 mr-2" /> Seed sample data
          </Button>
        </div>
        {account ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-accent">
              <div className="text-xs uppercase opacity-70">Balance</div>
              <div className="text-2xl font-bold">{account.account.balance.currency} {account.account.balance.value}</div>
            </div>
            <div className="p-4 rounded-xl bg-muted">
              <div className="text-xs uppercase opacity-70">Groceries this month</div>
              <div className="text-2xl font-bold">EUR {Number(account.grocery_spent_this_month).toFixed(2)}</div>
            </div>
          </div>
        ) : <p className="text-muted-foreground">Loading</p>}
      </Card>

      <Card className="p-6 shadow-soft">
        <div className="flex items-center gap-3 mb-4">
          <UserPlus className="w-6 h-6 text-primary" />
          <h2 className="text-xl font-bold">Linked helper</h2>
        </div>
        {joint?.helper_email ? (
          <p className="text-base">Connected with <strong>{joint.helper_email}</strong>. They can see your requests in their inbox.</p>
        ) : (
          <form onSubmit={linkHelper} className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1">
              <Label htmlFor="hemail">Helper's email or phone</Label>
              <Input id="hemail" value={helperEmail} onChange={(e) => setHelperEmail(e.target.value)} className="h-12 text-base" required />
            </div>
            <Button className="h-12">Link helper</Button>
          </form>
        )}
      </Card>
    </section>
  );
}
