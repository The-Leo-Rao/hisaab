"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { openInvoice, type InvoiceDoc, type SealedInvoice } from "@hisaab/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function KeyUnlock({ sealed, onOpen }: { sealed: SealedInvoice; onOpen: (doc: InvoiceDoc, key: string) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-3 rounded-md border border-ink/70 bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onOpen(await openInvoice(sealed, key), key.trim());
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h2 className="title flex items-center gap-2">
          <KeyRound className="size-5" /> Sealed PDF loaded
        </h2>
        <p className="mt-1 text-[15px] text-ink-2">
          Enter the invoice key for #{sealed.id}. It is checked in this browser and never sent anywhere. Without it, this page only shows public facts.
        </p>
      </div>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="invoice-key">
          Invoice key
        </label>
        <Input
          id="invoice-key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={`HSB${sealed.id}-XXXX-XXXX-…`}
          autoComplete="off"
          spellCheck={false}
          className="num min-w-0 flex-1"
        />
        <Button type="submit" disabled={busy || !key.trim()}>
          Unlock
        </Button>
      </div>
      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
