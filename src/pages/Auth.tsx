import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import heroImg from "@/assets/hero.jpg";

export default function Auth() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"visually_impaired" | "helper">("visually_impaired");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { display_name: displayName, role },
          },
        });
        if (error) throw error;
        toast.success("Welcome! You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
      }
      nav("/");
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative">
        <img src={heroImg} alt="" className="absolute inset-0 w-full h-full object-cover" width={1536} height={768} />
        <div className="absolute inset-0 gradient-hero opacity-70" />
        <div className="relative z-10 h-full flex flex-col justify-end p-12 text-primary-foreground">
          <h1 className="text-5xl font-bold leading-tight mb-4">Shop with confidence.</h1>
          <p className="text-xl opacity-90 max-w-md">
            A voice-first grocery assistant with a trusted helper one tap away.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <Card className="w-full max-w-md p-8 shadow-strong">
          <header className="mb-6">
            <h2 className="text-3xl font-bold mb-2">
              {mode === "signup" ? "Create your account" : "Sign in"}
            </h2>
            <p className="text-muted-foreground">
              {mode === "signup" ? "Join Beacon  your shopping companion." : "Welcome back to Beacon."}
            </p>
          </header>

          <form onSubmit={submit} className="space-y-5">
            {mode === "signup" && (
              <>
                <div>
                  <Label htmlFor="name" className="text-base">Your name</Label>
                  <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="h-12 text-base" />
                </div>
                <div>
                  <Label className="text-base mb-2 block">I am</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setRole("visually_impaired")}
                      className={`p-4 rounded-xl border-2 text-left transition-smooth ${role === "visually_impaired" ? "border-primary bg-accent" : "border-border"}`}>
                      <div className="font-semibold">Shopping</div>
                      <div className="text-sm text-muted-foreground">I want help while I shop</div>
                    </button>
                    <button type="button" onClick={() => setRole("helper")}
                      className={`p-4 rounded-xl border-2 text-left transition-smooth ${role === "helper" ? "border-primary bg-accent" : "border-border"}`}>
                      <div className="font-semibold">Helping</div>
                      <div className="text-sm text-muted-foreground">I support a loved one</div>
                    </button>
                  </div>
                </div>
              </>
            )}
            <div>
              <Label htmlFor="email" className="text-base">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12 text-base" />
            </div>
            <div>
              <Label htmlFor="password" className="text-base">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="h-12 text-base" />
            </div>

            <Button type="submit" disabled={loading} size="lg" className="w-full h-14 text-lg gradient-hero text-primary-foreground border-0">
              {loading ? "Please wait" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            className="mt-6 text-base text-primary hover:underline w-full text-center">
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </Card>
      </div>
    </div>
  );
}
