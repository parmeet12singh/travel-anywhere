import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The site's base path: "/" by default (local, Cloudflare Pages). The GitHub Pages workflow builds with
// BASE_PATH=/travel-anywhere/, because the site lives at parmeet12singh.github.io/travel-anywhere/.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
});
