"use client";
import { useState } from "react";

export function ConnectButtons() {
  const [msg, setMsg] = useState("");

  async function connect() {
    setMsg("Connexion…");
    try {
      const res = await fetch("/api/connect", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setMsg(`Erreur : ${data.error ?? "inconnue"}`);
    } catch {
      setMsg("Erreur réseau : impossible de contacter le serveur.");
    }
  }

  async function sync() {
    setMsg("Synchronisation…");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      setMsg(res.ok ? `Importé : ${data.imported} transactions.` : `Erreur : ${data.error}`);
    } catch {
      setMsg("Erreur réseau : impossible de contacter le serveur.");
    }
  }

  return (
    <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
      <button onClick={connect}>Connecter ma banque (CIC)</button>
      <button onClick={sync}>Synchroniser</button>
      <span>{msg}</span>
    </div>
  );
}
