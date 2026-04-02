import { describe, expect, it, vi } from "vitest";
import { getFormDataHeaders, isFormData } from "./form-data";

describe("form-data helpers", () => {
  it("detects form-data like objects", () => {
    const formLike = {
      append: () => {},
      getHeaders: () => ({ "content-type": "multipart/form-data" }),
    };
    expect(isFormData(formLike)).toBe(true);
    expect(isFormData({})).toBe(false);
  });

  it("detects native FormData", () => {
    const form = new FormData();
    form.append("field", "value");
    expect(isFormData(form)).toBe(true);
  });

  it("returns headers from form-data", () => {
    const formLike = {
      append: vi.fn(),
      getHeaders: () => ({ "content-type": "multipart/form-data" }),
    };
    expect(getFormDataHeaders(formLike)).toEqual({
      "content-type": "multipart/form-data",
    });
  });
});
