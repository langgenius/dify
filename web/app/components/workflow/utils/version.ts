export type WorkflowVersionNameSource = {
  marked_name?: string | null
  version_number?: number | null
}

export const getWorkflowVersionName = (
  version: WorkflowVersionNameSource | null | undefined,
  defaultName: string,
): string => {
  if (version?.marked_name) return version.marked_name
  if (version?.version_number) return `# ${version.version_number}`

  return defaultName
}
