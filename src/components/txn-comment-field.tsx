"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { setComment } from "@/app/transactions/actions";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { hasComment } from "@/lib/txn-comment";

// Le commentaire d'une transaction, posé sous son libellé. Même schéma que
// GroupSelectField et IgnoreTxnToggle : action serveur puis router.refresh()
// (revalidatePath seul ne rafraîchit pas la vue courante).
//
// Sans commentaire, la ligne se réduit à un bouton discret qui n'apparaît qu'au
// survol : une transaction commentée doit se voir, une transaction ordinaire ne
// doit pas payer une ligne vide.
export function TxnCommentField({ txnId, comment, className }: {
  txnId: string;
  comment?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment ?? "");
  const [pending, startTransition] = useTransition();

  const enregistrer = (value: string) => {
    setEditing(false);
    // Rien n'a bougé : pas d'aller-retour serveur pour un champ ouvert puis refermé.
    if (value === (comment ?? "")) return;
    startTransition(async () => {
      await setComment(txnId, value);
      router.refresh();
    });
  };

  const ouvrir = () => {
    setDraft(comment ?? "");
    setEditing(true);
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        disabled={pending}
        placeholder="Commentaire"
        aria-label="Commentaire de la transaction"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => enregistrer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") enregistrer(e.currentTarget.value);
          // Échap abandonne : le brouillon repart de ce qui est enregistré.
          if (e.key === "Escape") {
            setDraft(comment ?? "");
            setEditing(false);
          }
        }}
        className={cn("h-7 text-sm", className)}
      />
    );
  }

  if (!hasComment(comment)) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={ouvrir}
        className={cn(
          "text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-[11px]",
          "opacity-0 group-hover/txn:opacity-100 focus-visible:opacity-100",
          className,
        )}
      >
        <MessageSquarePlus className="size-3" />
        Commenter
      </button>
    );
  }

  return (
    // Un commentaire se relit et se corrige au même endroit : le texte lui-même est
    // le bouton, plutôt qu'un crayon de plus dans une ligne déjà chargée.
    <button
      type="button"
      disabled={pending}
      onClick={ouvrir}
      aria-label="Modifier le commentaire"
      className={cn(
        "text-muted-foreground hover:text-foreground w-full text-left text-[11px] leading-4 break-words whitespace-normal italic",
        className,
      )}
    >
      {comment}
    </button>
  );
}
