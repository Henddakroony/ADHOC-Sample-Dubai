import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@arcgis")) return "arcgis";
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory")) return "charts";
          if (id.includes("xlsx")) return "xlsx";
          if (id.includes("leaflet")) return "leaflet";
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
});
