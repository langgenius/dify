import { describe, expect, it } from "vitest";

import { createApiSourceBulkRemovalRequester } from "./source-product-options";

describe("API Source product assembly", () => {
  it("fails production startup when durable source removal cannot be assembled", () => {
    expect(() => createApiSourceBulkRemovalRequester({ production: true })).toThrow(
      "Production Source bulk removal requires the durable deletion repository",
    );
  });

  it("keeps an unconfigured development Source product disabled", () => {
    expect(createApiSourceBulkRemovalRequester({ production: false })).toBeUndefined();
  });

  it("assembles the production requester when the durable deletion repository exists", () => {
    const requester = createApiSourceBulkRemovalRequester({
      production: true,
      repository: { requestSourceDeletion: async () => ({ created: true }) } as never,
    });
    expect(requester).toMatchObject({
      find: expect.any(Function),
      get: expect.any(Function),
      request: expect.any(Function),
    });
  });
});
