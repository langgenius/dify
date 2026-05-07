import type { Headers } from "../types/common";

type FormDataAppendValue = Blob | string;

export type WebFormData = FormData;

export type LegacyNodeFormData = {
  append: (name: string, value: FormDataAppendValue, fileName?: string) => void;
  getHeaders: () => Headers;
  constructor?: { name?: string };
};

export type SdkFormData = WebFormData | LegacyNodeFormData;

export const isFormData = (value: unknown): value is SdkFormData => {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return true;
  }
  const candidate = value as Partial<LegacyNodeFormData>;
  if (typeof candidate.append !== "function") {
    return false;
  }
  if (typeof candidate.getHeaders === "function") {
    return true;
  }
  return candidate.constructor?.name === "FormData";
};

export const getFormDataHeaders = (form: SdkFormData): Headers => {
  if ("getHeaders" in form && typeof form.getHeaders === "function") {
    return form.getHeaders();
  }
  return {};
};
