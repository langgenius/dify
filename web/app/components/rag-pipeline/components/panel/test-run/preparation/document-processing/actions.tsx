import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'

type ActionsProps = {
  formParams: CustomActionsProps
  runDisabled?: boolean
  onBack: () => void
}

const Actions = ({
  formParams,
  runDisabled,
  onBack,
}: ActionsProps) => {
  const { t } = useTranslation()
  const { form, isSubmitting, canSubmit } = formParams
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const isRunning = workflowRunningData?.result.status === WorkflowRunningStatus.Running

  return (
    <div className="flex items-center justify-end gap-x-2 p-4 pt-2">
      <Button
        variant="secondary"
        onClick={onBack}
      >
        {t('operations.backToDataSource', { ns: 'datasetPipeline' })}
      </Button>
      <Button
        variant="primary"
        onClick={() => {
          form.handleSubmit()
        }}
        disabled={runDisabled || isSubmitting || !canSubmit || isRunning}
        loading={isSubmitting || isRunning}
      >
        {t('operations.process', { ns: 'datasetPipeline' })}
      </Button>
    </div>
  )
}

export default React.memo(Actions)
