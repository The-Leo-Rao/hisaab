"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PdfDropZone } from "@/components/PdfDropZone";

export default function VerifyLookup() {
  const router = useRouter();
  const [id, setId] = useState("");
  return (
    <div className="mx-auto max-w-[640px]">
      <PageTitle title={<>Verify an <em>invoice</em></>} sub="No wallet needed. Type the invoice number, scan its QR code, or drop its PDF." />
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^\d+$/.test(id.trim())) router.push(`/verify/${id.trim()}`);
        }}
      >
        <label className="sr-only" htmlFor="inv">
          Invoice number
        </label>
        <Input id="inv" inputMode="numeric" placeholder="Invoice number, e.g. 12" value={id} onChange={(e) => setId(e.target.value)} className="num" />
        <Button type="submit">Verify</Button>
      </form>
      <div className="mt-8">
        <PdfDropZone
          onResult={(r) => {
            if (r.exists && r.document) {
              try {
                sessionStorage.setItem(`hisaab:drop:${r.id}`, JSON.stringify(r.document));
              } catch {}
            }
            router.push(`/verify/${r.id}`);
          }}
        />
      </div>
    </div>
  );
}
