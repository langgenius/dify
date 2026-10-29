'use client'

import type { SubmitEvent } from 'react'
import type { WorkflowHiddenStartVariable, WorkflowLaunchInputValue } from '../app-card-utils'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
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
  launchDisabled: boolean
  targetUrl: string
  onClose: () => void
}

function WorkflowLaunchForm({
  hiddenVariables,
  launchDisabled,
  targetUrl,
  onClose,
}: WorkflowLaunchFormProps) {
  const { t } = useTranslation(['appOverview', 'common'])
  const [values, setValues] = useState<Record<string, WorkflowLaunchInputValue>>(() =>
    createWorkflowLaunchInitialValues(hiddenVariables),
  )

  function handleValueChange(variable: string, value: WorkflowLaunchInputValue) {
    setValues((currentValues) => ({
      ...currentValues,
      [variable]: value,
    }))
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (launchDisabled) return

    const launchUrl = await buildWorkflowLaunchUrl({
      accessibleUrl: targetUrl,
      variables: hiddenVariables,
      values,
    })

    window.open(launchUrl, '_blank')
    onClose()
  }

  return (
    <form className="contents" onSubmit={handleSubmit}>
      <DialogBody className="space-y-4">
        <WorkflowHiddenInputFields
          hiddenVariables={hiddenVariables}
          values={values}
          onValueChange={handleValueChange}
        />
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
        <Button type="submit" variant="primary" disabled={launchDisabled}>
          {t(($) => $['overview.appInfo.launch'], { ns: 'appOverview' })}
        </Button>
      </DialogFooter>
    </form>
  )
}

type WorkflowLaunchDialogProps = {
  hiddenVariables: WorkflowHiddenStartVariable[]
  launchDisabled?: boolean
  open: boolean
  targetUrl: string
  onOpenChange: (open: boolean) => void
}

export function WorkflowLaunchDialog({
  hiddenVariables,
  launchDisabled = false,
  open,
  targetUrl,
  onOpenChange,
}: WorkflowLaunchDialogProps) {
  const { t } = useTranslation(['appOverview'])
  const supportedVariables = hiddenVariables.filter(isWorkflowLaunchInputSupported)

  if (!hiddenVariables.length) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-140">
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['overview.appInfo.workflowLaunchHiddenInputs.title'], {
              ns: 'appOverview',
            })}
          </DialogTitle>
          <DialogDescription>
            <Trans
              i18nKey={($) => $['overview.appInfo.workflowLaunchHiddenInputs.description']}
              ns="appOverview"
              components={{ bold: <span className="system-md-medium" /> }}
            />
          </DialogDescription>
        </DialogHeader>
        <WorkflowLaunchForm
          key={open ? `open:${targetUrl}` : 'closed'}
          hiddenVariables={supportedVariables}
          launchDisabled={launchDisabled}
          targetUrl={targetUrl}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
