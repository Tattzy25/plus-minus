// ─────────────────────────────────────────────
// PLUS-CREDITS RULES
// ─────────────────────────────────────────────

export const PLUS_REQUIRED_FIELDS = ["customerId", "userId", "creditAmount", "email", "sourceId"];
export const PLUS_PURCHASE_REQUIRED_FIELDS = ["purchaseOrderId"];

export function validatePlus(args: Record<string, any>): string[] {
  const missing: string[] = [];
  for (const field of PLUS_REQUIRED_FIELDS) {
    if (!args[field]) missing.push(field);
  }
  if (args.sourceId !== "new-user-signup") {
    for (const field of PLUS_PURCHASE_REQUIRED_FIELDS) {
      if (!args[field]) missing.push(field);
    }
  }
  return missing;
}


// ─────────────────────────────────────────────
// MINUS-CREDITS RULES
// ─────────────────────────────────────────────

export const MINUS_REQUIRED_FIELDS = ["customerId", "userId", "creditAmount", "email", "sourceId", "timestamp"];


export function validateMinus(args: Record<string, any>): string[] {
  const missing: string[] = [];
  for (const field of MINUS_REQUIRED_FIELDS) {
    if (!args[field]) missing.push(field);
  }
  return missing;
}

// If current balance is already negative → reject
export function isBalanceEligible(currentBalance: string): boolean {
  return parseFloat(currentBalance) >= 0;
}

// Generate timestamp if not provided
export function resolveTimestamp(timestamp?: string): string {
  return timestamp || new Date().toISOString();
}
