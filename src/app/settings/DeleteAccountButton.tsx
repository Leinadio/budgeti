"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteAccountAction } from "./actions";

export function DeleteAccountButton({ accountId }: { accountId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Supprimer
      </Button>
    );
  }

  return (
    <form action={deleteAccountAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={accountId} />
      <Button type="submit" size="sm" variant="destructive">
        Confirmer
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Annuler
      </Button>
    </form>
  );
}
