'use client'

import type { FormEvent } from 'react'
import type {
  WorkflowHiddenStartVariable,
  WorkflowLaunchInputValue,
} from '@/app/components/app/overview/app-card-utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkflowLaunchDialog } from '@/app/components/app/overview/app-card-sections'
import {
  buildWorkflowLaunchUrl,
  createWorkflowLaunchInitialValues,
  isWorkflowLaunchInputSupported,
} from '@/app/components/app/overview/app-card-utils'

type AccessPointWorkflowLaunchDialogProps = {
  hiddenVariables: WorkflowHiddenStartVariable[]
  targetUrl: string
  onClose: () => void
}

export function AccessPointWorkflowLaunchDialog({
  hiddenVariables,
  targetUrl,
  onClose,
}: AccessPointWorkflowLaunchDialogProps) {
  const { t } = useTranslation()
  const supportedVariables = hiddenVariables.filter(isWorkflowLaunchInputSupported)
  const unsupportedVariables = hiddenVariables.filter(
    (variable) => !isWorkflowLaunchInputSupported(variable),
  )
  const [values, setValues] = useState<Record<string, WorkflowLaunchInputValue>>(() =>
    createWorkflowLaunchInitialValues(supportedVariables),
  )

  const handleValueChange = (variable: string, value: WorkflowLaunchInputValue) => {
    setValues((currentValues) => ({
      ...currentValues,
      [variable]: value,
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const launchUrl = await buildWorkflowLaunchUrl({
      accessibleUrl: targetUrl,
      variables: supportedVariables,
      values,
    })

    window.open(launchUrl, '_blank')
    onClose()
  }

  return (
    <WorkflowLaunchDialog
      t={t}
      open
      hiddenVariables={supportedVariables}
      unsupportedVariables={unsupportedVariables}
      values={values}
      onOpenChange={(open) => !open && onClose()}
      onValueChange={handleValueChange}
      onSubmit={handleSubmit}
    />
  )
}
