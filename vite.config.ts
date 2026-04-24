import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

function ragApiPlugin() {
  return {
    name: 'rag-api',
    configureServer(server: any) {
      server.middlewares.use('/api/rag', (req: any, res: any) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: any) => {
            body += chunk.toString();
          });
          req.on('end', async () => {
            try {
              // Load the RAG pipeline dynamically so it runs in the backend context
              const { processProductImage } = await server.ssrLoadModule('/src/lib/productRag.ts');
              const data = JSON.parse(body);
              const result = await processProductImage(data.imageBase64);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
            } catch (e: any) {
              console.error("RAG API Error:", e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
        }
      });
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger(), ragApiPlugin()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
