import { PayView } from "@/components/pay/PayView";

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayView id={/^\d{1,30}$/.test(id) ? id : "0"} />;
}
