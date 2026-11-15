export type CleanupTask = {
  label: string
  run: () => Promise<void> | void
}

export const shouldFailForCleanupErrors = (status: string | undefined) =>
  status === 'PASSED' || status === 'SKIPPED'

export async function runCleanupTasks(tasks: CleanupTask[]): Promise<string[]> {
  const errors: string[] = []

  for (const task of tasks) {
    try {
      await task.run()
    } catch (error) {
      errors.push(`${task.label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return errors
}
