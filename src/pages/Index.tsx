import { Navigate, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

export default function Index() {
  const { user, role, loading } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) nav("/auth", { replace: true });
    else nav(role === "helper" ? "/inbox" : "/shop", { replace: true });
  }, [user, role, loading, nav]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground text-lg">Loading Beacon…</div>
    </div>
  );
}
