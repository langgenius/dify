import type { WorkflowHiddenStartVariable } from '@/app/components/app/overview/app-card-utils'
import type { InputVar } from '@/app/components/workflow/types'
import { useState } from 'react'

export function useWorkflowLaunch(inputs?: InputVar[]) {
  const [targetUrl, setTargetUrl] = useState<string>()
  const hiddenVariables: WorkflowHiddenStartVariable[] = (inputs ?? []).filter(
    (input) => input.hide === true,
  )

  function openDialog(nextTargetUrl: string) {
    setTargetUrl(nextTargetUrl)
  }

  function handleOpenChange(open: boolean) {
    if (!open) setTargetUrl(undefined)
  }

  return {
    hasHiddenVariables: hiddenVariables.length > 0,
    hiddenVariables,
    onOpenChange: handleOpenChange,
    open: targetUrl !== undefined,
    openDialog,
    targetUrl: targetUrl ?? '',
  }
}
