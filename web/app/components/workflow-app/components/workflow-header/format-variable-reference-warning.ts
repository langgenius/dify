import type { WorkflowVariableReferenceWarningResponse } from '@dify/contracts/api/console/apps/types.gen'

export const MAX_REPORTED_VARIABLE_REFERENCE_ISSUES = 10

export const formatVariableReferenceWarningPairs = (
  issues: WorkflowVariableReferenceWarningResponse[],
  moreLabel: (overflow: number) => string,
): string => {
  const shown = issues.slice(0, MAX_REPORTED_VARIABLE_REFERENCE_ISSUES)
  const pairs = shown
    .map((issue) => `"${issue.node_title}" ← "${issue.referenced_node_title}"`)
    .join('; ')
  const overflow = issues.length - shown.length
  return overflow > 0 ? `${pairs}; ${moreLabel(overflow)}` : pairs
}
