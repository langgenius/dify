import type { Headers } from "../types/common";

export type FormDataLike = {
  append: (...args: unknown[]) => void;
  getHeaders?: () => Headers;
  constructor?: { name?: string };
};

export const isFormData = (value: unknown): value is FormDataLike => {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return true;
  }
  const candidate = value as FormDataLike;
  if (typeof candidate.append !== "function") {
    return false;
  }
  if (typeof candidate.getHeaders === "function") {
    return true;
  }
  return candidate.constructor?.name === "FormData";
};

export const getFormDataHeaders = (form: FormDataLike): Headers => {
  if (typeof form.getHeaders === "function") {
    return form.getHeaders();
  }
  return {};
};
