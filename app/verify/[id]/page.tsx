import { VerifyView } from "@/components/verify/VerifyView";

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VerifyView id={/^\d{1,30}$/.test(id) ? id : "0"} />;
}
