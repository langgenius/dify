import { describe, expect, it } from "vitest";

import {
  SOURCE_OPERATION_FAILURES,
  safeSourceOperationError,
  sourceOperationFailureMetadata,
} from "./source-operation-error";
import { WebsiteCrawlConnectorConfigError } from "./website-crawl-connector";

describe("safeSourceOperationError", () => {
  it("maps unknown connector failures without retaining secret-bearing messages", () => {
    const failure = safeSourceOperationError(
      "websiteCrawl",
      new Error("Authorization: Bearer credential-secret"),
    );

    expect(failure).toEqual(SOURCE_OPERATION_FAILURES.websiteCrawl);
    expect(JSON.stringify(failure)).not.toContain("credential-secret");
    expect(sourceOperationFailureMetadata(failure)).toEqual({
      error: SOURCE_OPERATION_FAILURES.websiteCrawl.message,
      errorCode: SOURCE_OPERATION_FAILURES.websiteCrawl.code,
    });
  });

  it("allows a typed local configuration error with a stable code", () => {
    const error = new WebsiteCrawlConnectorConfigError(
      "Website crawl source source-1 metadata.provider is required",
    );

    expect(safeSourceOperationError("websiteCrawl", error)).toEqual({
      code: "SOURCE_WEBSITE_CRAWL_CONFIG_INVALID",
      message: error.message,
    });
  });
});
