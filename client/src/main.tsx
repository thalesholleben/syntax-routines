import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
// Montserrat self-hospedada (sem requisicao ao Google Fonts), igual ao Syntax Ops.
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
