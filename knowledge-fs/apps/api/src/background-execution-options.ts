export type BackgroundExecutionMode = "embedded" | "celery";

/** Opt-in cutover: deployment templates select Celery; old local environments remain compatible. */
export function resolveBackgroundExecutionMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): BackgroundExecutionMode {
  const value =
    env.DIFY_ROOT_KNOWLEDGE_BACKGROUND_EXECUTION_OVERRIDE?.trim() ||
    env.KNOWLEDGE_BACKGROUND_EXECUTION?.trim() ||
    "embedded";
  if (value !== "embedded" && value !== "celery") {
    throw new Error("KNOWLEDGE_BACKGROUND_EXECUTION must be embedded or celery");
  }
  return value;
}
