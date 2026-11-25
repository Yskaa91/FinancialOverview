import { describe, expect, it } from "vitest";

import { CATEGORY_PALETTE, pickCategoryColor } from "@/lib/colors";

describe("pickCategoryColor", () => {
  it("returns a palette colour in #rrggbb form", () => {
    for (let i = 0; i < 50; i += 1) {
      const colour = pickCategoryColor();
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(CATEGORY_PALETTE as readonly string[]).toContain(colour);
    }
  });

  it("honours the injected random source", () => {
    expect(pickCategoryColor([], () => 0)).toBe(CATEGORY_PALETTE[0]);
    expect(pickCategoryColor([], () => 0.999)).toBe(CATEGORY_PALETTE.at(-1));
  });

  it("never returns undefined when random returns exactly 1", () => {
    const colour = pickCategoryColor([], () => 1);
    expect(typeof colour).toBe("string");
    expect(colour).toBe(CATEGORY_PALETTE.at(-1));
  });

  it("skips colours already in use", () => {
    const taken = CATEGORY_PALETTE.slice(0, -1);
    expect(pickCategoryColor(taken, () => 0)).toBe(CATEGORY_PALETTE.at(-1));
  });

  it("ignores nulls and case when deciding what is taken", () => {
    const taken: (string | null)[] = [null, CATEGORY_PALETTE[0].toUpperCase()];
    expect(pickCategoryColor(taken, () => 0)).toBe(CATEGORY_PALETTE[1]);
  });

  it("falls back to the whole palette when every colour is taken", () => {
    expect(pickCategoryColor([...CATEGORY_PALETTE], () => 0)).toBe(CATEGORY_PALETTE[0]);
  });
});
