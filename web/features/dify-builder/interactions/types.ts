export type SubmitInteraction = (
  actionId: string,
  payload?: Record<string, unknown>,
) => Promise<boolean>
