import React from "react";
import ReactDOM from "react-dom/client";
import TestApp from "./TestApp";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

root.render(
  <React.StrictMode>
    <TestApp />
  </React.StrictMode>
);
