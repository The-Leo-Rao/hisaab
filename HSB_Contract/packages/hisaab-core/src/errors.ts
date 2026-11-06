import { BaseError, ContractFunctionRevertedError } from "viem";

export const REVERT_REASONS: Record<string, string> = {
  ZeroAmount: "The amount must be more than zero.",
  BadDueDate: "The due date must be in the future.",
  NoDocHash: "The invoice document hash is missing.",
  NameTooLong: "ENS names on an invoice can be at most 64 bytes.",
  BadSupersede: "Only your own cancelled or fully refunded invoice can be replaced, and only once.",
  NotPayable: "This invoice is not accepting payments: it is paid, cancelled, refunded, or frozen after a partial refund.",
  NotClient: "Only the client wallet named on this invoice can pay it.",
  WrongPayer: "This invoice is locked to the wallet that made the first payment. The issuer can refund it and reissue.",
  Overpay: "That is more than the remaining balance on this invoice.",
  NotRefundable: "Only paid or partly paid invoices can be refunded.",
  OverRefund: "You cannot refund more than was paid.",
  NotCancellable: "Only an open invoice with no payments can be cancelled.",
  NotIssuer: "Only the issuer can do this.",
  NotParty: "Only the issuer or the named client can cancel this invoice.",
  InvoiceNotFound: "No invoice with this id exists.",
  ERC20InsufficientBalance: "Not enough USDT in this wallet.",
  ERC20InsufficientAllowance: "The registry is not approved to move this much USDT yet.",
  AuthorizationExpired: "The payment signature expired. Sign again.",
  AuthorizationUsed: "This payment signature was already used.",
  InvalidSignature: "The payment signature does not match the paying wallet.",
};

export function revertName(e: unknown): string | null {
  if (!(e instanceof BaseError)) return null;
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? null) : null;
}

export function explainError(e: unknown): string {
  const name = revertName(e);
  if (name) return REVERT_REASONS[name] ?? `Reverted: ${name}`;
  if (e instanceof BaseError) return e.shortMessage;
  return e instanceof Error ? e.message : String(e);
}
