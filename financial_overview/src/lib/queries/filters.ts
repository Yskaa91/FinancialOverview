import type { Prisma } from "@prisma/client";

/**
 * Transfers between own accounts are neither income nor expense: one category,
 * `Transfers` (kind TRANSFER), keeps them out of every total without any pairing
 * or balancing. Rows with no category yet still count.
 */
export const notTransfer: Prisma.TransactionWhereInput = {
  OR: [{ categoryId: null }, { category: { kind: { not: "TRANSFER" } } }],
};
