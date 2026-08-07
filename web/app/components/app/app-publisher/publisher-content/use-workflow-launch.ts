import type { FormEvent } from 'react'
import type {
  WorkflowHiddenStartVariable,
  WorkflowLaunchInputValue,
} from '@/app/components/app/overview/app-card-utils'
import type { InputVar } from '@/app/components/workflow/types'
import { useState } from 'react'
import {
  buildWorkflowLaunchUrl,
  createWorkflowLaunchInitialValues,
  isWorkflowLaunchInputSupported,
} from '@/app/components/app/overview/app-card-utils'

export function useWorkflowLaunch(inputs?: InputVar[]) {
  const [open, setOpen] = useState(false)
  const [targetUrl, setTargetUrl] = useState('')
  const [values, setValues] = useState<Record<string, WorkflowLaunchInputValue>>({})
  const hiddenVariables: WorkflowHiddenStartVariable[] = (inputs ?? []).filter(
    (input) => input.hide === true,
  )
  const supportedVariables = hiddenVariables.filter(isWorkflowLaunchInputSupported)
  const unsupportedVariables = hiddenVariables.filter(
    (variable) => !isWorkflowLaunchInputSupported(variable),
  )

  function openDialog(nextTargetUrl: string) {
    setValues(createWorkflowLaunchInitialValues(supportedVariables))
    setTargetUrl(nextTargetUrl)
    setOpen(true)
  }

  function handleValueChange(variable: string, value: WorkflowLaunchInputValue) {
    setValues((previousValues) => ({
      ...previousValues,
      [variable]: value,
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const url = await buildWorkflowLaunchUrl({
      accessibleUrl: targetUrl,
      variables: supportedVariables,
      values,
    })

    window.open(url, '_blank')
    setOpen(false)
  }

  return {
    hasHiddenVariables: hiddenVariables.length > 0,
    handleSubmit,
    handleValueChange,
    open,
    openDialog,
    setOpen,
    supportedVariables,
    unsupportedVariables,
    values,
  }
}
