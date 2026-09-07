import { describe, expect, it } from "vitest";
import { isImageInputRejection, validateImageVariantResponse } from "./image-variant-protocol";
import { imageVariantsFromResponse } from "./isolated-image-variant-generator";

const variant = () => ({
  body: new Uint8Array([1]),
  contentType: "image/png",
  name: "analysis",
  height: 12,
  width: 24,
});

describe("image worker IPC response validation", () => {
  it("classifies malformed worker replies as operational errors, not rejected documents", () => {
    expect(() => imageVariantsFromResponse({ ok: true, variants: [{}] })).toThrow(
      expect.objectContaining({ code: "provider_response_invalid" }),
    );
    expect(() =>
      imageVariantsFromResponse({ ok: false, message: "Input image exceeds pixel limit" }),
    ).toThrow(expect.objectContaining({ code: "provider_input" }));
    expect(imageVariantsFromResponse({ ok: true, variants: [variant()] })).toHaveLength(1);
  });
  it.each([
    "Input image exceeds pixel limit",
    "Input buffer contains unsupported image format",
    "Sharp image thumbnail output exceeds maxOutputBytes",
    "Image variants exceed the output byte budget",
  ])("recognizes bounded image rejection: %s", (message) => {
    expect(isImageInputRejection(new Error(message))).toBe(true);
  });
  it.each([
    new Error("Cannot find package sharp"),
    new Error("Unexpected worker state"),
    "Input image exceeds pixel limit",
  ])("does not silently downgrade operational decoder failures", (error) => {
    expect(isImageInputRejection(error)).toBe(false);
  });
  it("rejects unbounded or malformed optional execution diagnostics", () => {
    expect(
      validateImageVariantResponse({
        ok: true,
        variants: [{ ...variant(), execution: { wallMs: Number.POSITIVE_INFINITY } }],
      }),
    ).toBe(false);
  });
  it("accepts bounded success and failure messages", () => {
    expect(validateImageVariantResponse({ ok: true, variants: [variant()] })).toBe(true);
    expect(validateImageVariantResponse({ ok: true, variants: [] })).toBe(true);
    expect(validateImageVariantResponse({ ok: false, message: "Image rejected" })).toBe(true);
  });
  it.each([
    undefined,
    null,
    [],
    {},
    { ok: 1 },
    { ok: true },
    { ok: true, variants: null },
    { ok: true, variants: [null] },
    { ok: true, variants: [variant(), variant(), variant()] },
    { ok: false, message: 1 },
    { ok: false, message: "" },
    { ok: false, message: "x".repeat(1025) },
  ])("rejects malformed message %j", (message) => {
    expect(validateImageVariantResponse(message)).toBe(false);
  });
  it.each([
    { body: [1] },
    { body: new Uint8Array() },
    { body: new Uint8Array(16 * 1024 * 1024 + 1) },
    { contentType: "text/plain" },
    { name: "../escape" },
    { name: "x".repeat(65) },
    { width: 0 },
    { height: -1 },
    { width: Number.NaN },
    { height: 1.5 },
  ])("rejects malformed variant field", (patch) => {
    expect(validateImageVariantResponse({ ok: true, variants: [{ ...variant(), ...patch }] })).toBe(
      false,
    );
  });
  it("bounds aggregate variant bytes and permits absent optional dimensions", () => {
    expect(
      validateImageVariantResponse({
        ok: true,
        variants: [
          { ...variant(), body: new Uint8Array(8 * 1024 * 1024 + 1) },
          { ...variant(), body: new Uint8Array(8 * 1024 * 1024) },
        ],
      }),
    ).toBe(false);
    expect(
      validateImageVariantResponse({
        ok: true,
        variants: [{ body: new Uint8Array([1]), contentType: "image/png", name: "thumbnail" }],
      }),
    ).toBe(true);
  });
});
