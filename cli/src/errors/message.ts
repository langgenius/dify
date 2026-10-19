/** The message to put in a one-line notice for a value caught from anywhere. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
