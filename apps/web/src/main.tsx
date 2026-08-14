import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.js";
import { getLang } from "./i18n.js";
import "./styles.css";

registerSW({ immediate: true });

document.documentElement.lang = getLang();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
