import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ShopPhone from "./pages/ShopPhone";

// AUTH REMOVED — all auth imports and Protected wrapper commented out
// import Auth from "./pages/Auth";
// import AppLayout from "./components/AppLayout";
// import Shop from "./pages/Shop";
// import Receipts from "./pages/Receipts";
// import Budget from "./pages/Budget";
// import Inbox from "./pages/Inbox";
// import { useAuth } from "./hooks/useAuth";
// function Protected({ children }: { children: React.ReactNode }) {
//   const { user, loading } = useAuth();
//   if (loading) return <div>Loading…</div>;
//   if (!user) return <Navigate to="/auth" replace />;
//   return <>{children}</>;
// }

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Simplified: single phone-mode page, no auth required */}
          <Route path="*" element={<ShopPhone />} />

          {/* OLD ROUTES — commented out
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route element={<Protected><AppLayout /></Protected>}>
            <Route path="/shop" element={<Shop />} />
            <Route path="/receipts" element={<Receipts />} />
            <Route path="/budget" element={<Budget />} />
            <Route path="/inbox" element={<Inbox />} />
          </Route>
          */}
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
