import type { Prisma } from "@prisma/client";

/**
 * Transfers between own accounts are neither income nor expense: one category,
 * `Transfers` (kind TRANSFER), keeps them out of every total without any pairing
 * or balancing. Rows with no category yet still count.
 */
export const notTransfer: Prisma.TransactionWhereInput = {
  AND: [
    { OR: [{ categoryId: null }, { category: { kind: { not: "TRANSFER" } } }] },
    // The other half of a movement between own accounts. A category cannot express
    // this: one leg keeps counting and the other must not, and a MANUAL category on
    // the excluded leg must not bring the double count back.
    { excludeFromSpending: false },
  ],
};
