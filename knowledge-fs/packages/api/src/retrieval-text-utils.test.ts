import { describe, expect, it } from "vitest";

import {
  detectRetrievalQueryLanguage,
  normalizeMixedLanguageFtsText,
} from "./retrieval-text-utils";

describe("retrieval text utilities", () => {
  it("normalizes mixed-language text for FTS without punctuation noise", () => {
    expect(normalizeMixedLanguageFtsText("合同ABC-123续约 terms")).toBe(
      "合 同 abc 123 续 约 terms",
    );
    expect(normalizeMixedLanguageFtsText("  Policy   renewal  ")).toBe("policy renewal");
    expect(normalizeMixedLanguageFtsText("！？")).toBe("");
  });

  it("detects retrieval query language with stable CJK/Latin categories", () => {
    expect(detectRetrievalQueryLanguage("合同续约")).toBe("cjk");
    expect(detectRetrievalQueryLanguage("policy renewal")).toBe("latin");
    expect(detectRetrievalQueryLanguage("合同 renewal")).toBe("mixed-cjk-latin");
    expect(detectRetrievalQueryLanguage("§")).toBe("other");
  });
});
