export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const hasStringProperty = <
  TKey extends string,
>(
  value: unknown,
  key: TKey
): value is Record<TKey, string> => isRecord(value) && typeof value[key] === "string";
