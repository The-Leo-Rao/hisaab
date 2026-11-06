import { Suspense } from "react";
import { IdentityView } from "@/components/identity/IdentityView";

export default function IdentityPage() {
  return (
    <Suspense fallback={<div className="skeleton mx-auto h-40 max-w-[720px]" />}>
      <IdentityView />
    </Suspense>
  );
}
