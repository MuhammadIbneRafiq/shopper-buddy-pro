import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Eye, ShoppingCart, Receipt, Inbox, Wallet, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export default function AppLayout() {
  const nav = useNavigate();
  const { user, role } = useAuth();

  const tabs = role === "helper"
    ? [
        { to: "/inbox", label: "Inbox", icon: Inbox },
        { to: "/budget", label: "Budget", icon: Wallet },
      ]
    : [
        { to: "/shop", label: "Shop", icon: ShoppingCart },
        { to: "/receipts", label: "Receipts", icon: Receipt },
        { to: "/budget", label: "Budget", icon: Wallet },
        { to: "/inbox", label: "Helper", icon: Inbox },
      ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl gradient-hero flex items-center justify-center">
              <Eye className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl">Beacon</span>
            {role && <span className="ml-2 text-xs px-2 py-1 rounded-full bg-accent text-accent-foreground capitalize">{role.replace("_", " ")}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); nav("/auth"); }}>
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-strong z-40" aria-label="Primary">
        <div className="container mx-auto px-2 grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-3 gap-1 text-sm font-medium transition-smooth ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`
              }>
              <t.icon className="w-6 h-6" aria-hidden />
              <span>{t.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
