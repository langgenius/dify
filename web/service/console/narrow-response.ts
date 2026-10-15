/**
 * Some UI types narrow fields that backend response models declare as plain strings or
 * loose records (enum-like statuses, `doc_form`, plugin `source`, locale label maps, ...).
 * Until those response models declare literal types, contract responses are narrowed to the
 * UI types at the service boundary with this helper instead of re-typing every consumer.
 * Prefer aliasing the generated type whenever the UI type can follow it.
 */
export const narrowResponse = <T>(response: Promise<unknown>) => response as Promise<T>
