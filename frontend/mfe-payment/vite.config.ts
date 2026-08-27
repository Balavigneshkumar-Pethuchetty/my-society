import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

export default defineConfig(({ command, mode }) => ({
  base: command === "serve" ? "/" : "/mfe-payment/",
  plugins: [
    react(),
    federation({
      name: "mfe_payment",
      filename: "remoteEntry.js",
      exposes: {
        "./PaymentApp": "./src/PaymentApp",
      },
      // Cast to any to satisfy type differences between plugin SharedConfig and our desired options
      shared: {
        react: { singleton: true, requiredVersion: "^18.3.1" },
        "react-dom": { singleton: true, requiredVersion: "^18.3.1" },
        "react-router-dom": { singleton: true, requiredVersion: "^6.24.1" },
        "@mui/material": { singleton: true, requiredVersion: "^5.16.7" },
        "@emotion/react": { singleton: true, requiredVersion: "^11.13.0" },
        "@emotion/styled": { singleton: true, requiredVersion: "^11.13.0" },
        i18next: { singleton: true, requiredVersion: "^26.3.6" },
        "react-i18next": { singleton: true, requiredVersion: "^17.0.11" },
      } as any,
    }),
  ],
  server: { port: 4003, cors: true },
  preview: { port: 4003, cors: true },
  build: {
    target: "esnext",
    modulePreload: false,
    minify: mode === "production",
    cssCodeSplit: false,
  },
}));
