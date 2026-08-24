'use client'

import type { FormEvent } from 'react'
import type { WorkflowHiddenStartVariable, WorkflowLaunchInputValue } from '../app-card-utils'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  buildWorkflowLaunchUrl,
  createWorkflowLaunchInitialValues,
  isWorkflowLaunchInputSupported,
} from '../app-card-utils'
import WorkflowHiddenInputFields from '../workflow-hidden-input-fields'

type WorkflowLaunchFormProps = {
  hiddenVariables: WorkflowHiddenStartVariable[]
  targetUrl: string
  onClose: () => void
}

function WorkflowLaunchForm({ hiddenVariables, targetUrl, onClose }: WorkflowLaunchFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, WorkflowLaunchInputValue>>(() =>
    createWorkflowLaunchInitialValues(hiddenVariables),
  )

  function handleValueChange(variable: string, value: WorkflowLaunchInputValue) {
    setValues((currentValues) => ({
      ...currentValues,
      [variable]: value,
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const launchUrl = await buildWorkflowLaunchUrl({
      accessibleUrl: targetUrl,
      variables: hiddenVariables,
      values,
    })

    window.open(launchUrl, '_blank')
    onClose()
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 px-6 pb-4">
        <WorkflowHiddenInputFields
          hiddenVariables={hiddenVariables}
          values={values}
          onValueChange={handleValueChange}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-divider-subtle px-6 py-4">
        <Button onClick={onClose}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
        <Button type="submit" variant="primary">
          {t(($) => $['overview.appInfo.launch'], { ns: 'appOverview' })}
        </Button>
      </div>
    </form>
  )
}

type WorkflowLaunchDialogProps = {
  hiddenVariables: WorkflowHiddenStartVariable[]
  open: boolean
  targetUrl: string
  onOpenChange: (open: boolean) => void
}

export function WorkflowLaunchDialog({
  hiddenVariables,
  open,
  targetUrl,
  onOpenChange,
}: WorkflowLaunchDialogProps) {
  const { t } = useTranslation()
  const supportedVariables = hiddenVariables.filter(isWorkflowLaunchInputSupported)

  if (!hiddenVariables.length) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-140! max-w-[calc(100vw-2rem)]! p-0!">
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['overview.appInfo.workflowLaunchHiddenInputs.title'], {
              ns: 'appOverview',
            })}
          </DialogTitle>
          <DialogDescription className="system-md-regular text-text-tertiary">
            <Trans
              i18nKey={($) => $['overview.appInfo.workflowLaunchHiddenInputs.description']}
              ns="appOverview"
              components={{ bold: <span className="system-md-medium" /> }}
            />
          </DialogDescription>
        </div>
        <WorkflowLaunchForm
          key={open ? `open:${targetUrl}` : 'closed'}
          hiddenVariables={supportedVariables}
          targetUrl={targetUrl}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
