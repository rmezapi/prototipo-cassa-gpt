// vite.config.js
import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

declare module "@remix-run/node" {
  interface Future {
    v3_singleFetch: true;
  }
}

const appPort = 5173; // Use a clear variable name

export default defineConfig({
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_singleFetch: true,
        v3_lazyRouteDiscovery: true,
      },
    }),
    tsconfigPaths(),
  ],
  // Add this server configuration block
  server: {
    port: appPort, // Main server port
    hmr: {
      // Ensure the HMR client connects back correctly
      protocol: 'ws',    // Use 'ws' (or 'wss' if you were using https)
      host: 'localhost', // Explicitly set the host
      port: appPort,     // Explicitly set the HMR server port (should match appPort)
      clientPort: appPort // **Force the client to use this port**
    },
  },
});