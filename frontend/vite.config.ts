import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Porta 5173: é a origem liberada no CORS dos serviços (CORS_ORIGINS).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
