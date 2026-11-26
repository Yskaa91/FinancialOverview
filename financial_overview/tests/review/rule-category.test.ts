import { describe, expect, it } from "vitest";

import { ruleCategoryFor } from "@/lib/review/rule-category";

const AI_PICK = "cat-ai";
const USER_PICK = "cat-user";
const RULE_PICK = "cat-rule";

describe("ruleCategoryFor", () => {
  it("gives the rule the category the user picked, not the AI suggestion", () => {
    expect(
      ruleCategoryFor({ decided: USER_PICK, proposalCategoryId: AI_PICK, matchCategoryId: null }),
    ).toBe(USER_PICK);
  });

  it("falls back to the suggestion when the user picked nothing", () => {
    expect(
      ruleCategoryFor({ decided: undefined, proposalCategoryId: AI_PICK, matchCategoryId: RULE_PICK }),
    ).toBe(AI_PICK);
  });

  it("falls back to the matched rule's category when there was no proposal", () => {
    expect(
      ruleCategoryFor({ decided: undefined, proposalCategoryId: null, matchCategoryId: RULE_PICK }),
    ).toBe(RULE_PICK);
  });

  it("creates no rule when the user left the group uncategorised", () => {
    expect(
      ruleCategoryFor({ decided: null, proposalCategoryId: AI_PICK, matchCategoryId: RULE_PICK }),
    ).toBeNull();
  });

  it("returns null when there is nothing to go on", () => {
    expect(ruleCategoryFor({ decided: undefined })).toBeNull();
  });
});
