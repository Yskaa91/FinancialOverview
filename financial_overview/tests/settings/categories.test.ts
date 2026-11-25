import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    category: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    transaction: { count: vi.fn(), groupBy: vi.fn() },
    rule: { count: vi.fn(), groupBy: vi.fn() },
    merchantMap: { groupBy: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// No ACCESS_PASSWORD in these tests, so the session guard passes.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateCategory } from "@/app/settings/actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const transfers = { name: "Transfers", kind: "TRANSFER", isSystem: true, _count: { children: 0 } };
const housing = { name: "Housing", kind: "EXPENSE", isSystem: false, _count: { children: 2 } };
const groceries = { name: "Groceries", kind: "EXPENSE", isSystem: false, _count: { children: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ACCESS_PASSWORD;
  prismaMock.category.findFirst.mockResolvedValue(null); // no name clash
  prismaMock.category.findUnique.mockResolvedValue(groceries);
});

describe("updateCategory guards", () => {
  it("edits an ordinary category", async () => {
    const result = await updateCategory({}, form({ id: "c1", name: "Food", kind: "EXPENSE", color: "#22c55e" }));

    expect(result).toEqual({});
    expect(prismaMock.category.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Food", kind: "EXPENSE", color: "#22c55e", parentId: null },
    });
  });

  it("refuses to rename the built-in Transfers category", async () => {
    prismaMock.category.findUnique.mockResolvedValue(transfers);

    const result = await updateCategory({}, form({ id: "c-transfers", name: "Moved money", kind: "TRANSFER" }));

    expect(result.error).toMatch(/built in/i);
    expect(prismaMock.category.update).not.toHaveBeenCalled();
  });

  it("refuses to change the kind of the built-in Transfers category", async () => {
    prismaMock.category.findUnique.mockResolvedValue(transfers);

    const result = await updateCategory({}, form({ id: "c-transfers", name: "Transfers", kind: "EXPENSE" }));

    expect(result.error).toMatch(/built in/i);
    expect(prismaMock.category.update).not.toHaveBeenCalled();
  });

  it("still lets a built-in category's colour change", async () => {
    prismaMock.category.findUnique.mockResolvedValue(transfers);

    const result = await updateCategory({}, form({ id: "c-transfers", name: "Transfers", kind: "TRANSFER", color: "#0f172a" }));

    expect(result).toEqual({});
    expect(prismaMock.category.update).toHaveBeenCalled();
  });

  it("refuses a kind change that would leave children mismatched", async () => {
    prismaMock.category.findUnique.mockResolvedValue(housing);

    const result = await updateCategory({}, form({ id: "c-housing", name: "Housing", kind: "INCOME" }));

    expect(result.error).toMatch(/subcategories/i);
    expect(prismaMock.category.update).not.toHaveBeenCalled();
  });

  it("allows renaming a parent that has children", async () => {
    prismaMock.category.findUnique.mockResolvedValue(housing);

    const result = await updateCategory({}, form({ id: "c-housing", name: "Home", kind: "EXPENSE" }));

    expect(result).toEqual({});
  });

  it("rejects a duplicate name in the same place", async () => {
    prismaMock.category.findFirst.mockResolvedValue({ id: "other" });

    const result = await updateCategory({}, form({ id: "c1", name: "Groceries", kind: "EXPENSE" }));

    expect(result.error).toMatch(/already exists/i);
    expect(prismaMock.category.update).not.toHaveBeenCalled();
  });

  it("refuses a parent that is itself a child", async () => {
    // The parent is looked up before the edited category, so this is call one.
    prismaMock.category.findUnique.mockResolvedValueOnce({ id: "rent", parentId: "housing" });

    const result = await updateCategory({}, form({ id: "c1", name: "Food", kind: "EXPENSE", parentId: "rent" }));

    expect(result.error).toMatch(/top-level/i);
    expect(prismaMock.category.update).not.toHaveBeenCalled();
  });

  it("refuses to delete the built-in Transfers category", async () => {
    const { deleteCategory } = await import("@/app/settings/actions");
    prismaMock.category.findUnique.mockResolvedValue({ isSystem: true });

    await deleteCategory(form({ categoryId: "c-transfers", confirm: "delete" }));

    expect(prismaMock.category.delete).not.toHaveBeenCalled();
  });

  it("deletes only with an explicit confirmation", async () => {
    const { deleteCategory } = await import("@/app/settings/actions");
    prismaMock.category.findUnique.mockResolvedValue({ isSystem: false });

    await deleteCategory(form({ categoryId: "c1" }));
    expect(prismaMock.category.delete).not.toHaveBeenCalled();

    await deleteCategory(form({ categoryId: "c1", confirm: "delete" }));
    expect(prismaMock.category.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });
});
