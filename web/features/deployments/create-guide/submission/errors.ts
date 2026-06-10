import type { UnsupportedDslNode } from '@/features/deployments/error'
import { toast } from '@langgenius/dify-ui/toast'
import { deploymentErrorMessage, unsupportedDslNodeError } from '@/features/deployments/error'

export async function handleCreateDeploymentSubmissionError({
  error,
  fallbackMessage,
  setSubmissionUnsupportedDslNodes,
}: {
  error: unknown
  fallbackMessage: string
  setSubmissionUnsupportedDslNodes: (nodes: UnsupportedDslNode[]) => void
}) {
  const unsupportedError = await unsupportedDslNodeError(error)
  if (unsupportedError?.nodes.length) {
    setSubmissionUnsupportedDslNodes(unsupportedError.nodes)
    return
  }

  toast.error(await deploymentErrorMessage(error) || fallbackMessage)
}
