'use client'

import type { EvaluationResourceProps } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { isEvaluationRunnable, useEvaluationResource } from '../../store'
import { EVALUATION_TEMPLATE_FILE_NAMES } from '../../store-utils'
import UploadRunPopover from '../batch-test-panel/input-fields/upload-run-popover'
import { useInputFieldsActions } from '../batch-test-panel/input-fields/use-input-fields-actions'

const PipelineBatchActions = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const isConfigReady = !!resource.judgeModelId && resource.metrics.some(metric => metric.kind === 'builtin')
  const isRunnable = isEvaluationRunnable(resource)
  const actions = useInputFieldsActions({
    resourceType,
    resourceId,
    isPanelReady: isConfigReady,
    isRunnable,
    templateFileName: EVALUATION_TEMPLATE_FILE_NAMES[resourceType],
  })

  return (
    <div className="flex gap-2 pt-2">
      <Button
        className="flex-1 justify-center"
        variant="secondary"
        disabled={!actions.canDownloadTemplate}
        onClick={actions.handleDownloadTemplate}
      >
        <span aria-hidden="true" className="mr-1 i-ri-file-excel-2-line h-4 w-4" />
        {t('batch.downloadTemplate')}
      </Button>
      <div className="flex-1">
        <UploadRunPopover
          open={actions.isUploadPopoverOpen}
          onOpenChange={actions.setIsUploadPopoverOpen}
          triggerDisabled={actions.uploadButtonDisabled}
          triggerLabel={t('pipeline.uploadAndRun')}
          inputFields={actions.templateColumns}
          currentFileName={actions.currentFileName}
          currentFileExtension={actions.currentFileExtension}
          currentFileSize={actions.currentFileSize}
          isFileUploading={actions.isFileUploading}
          isRunDisabled={actions.isRunDisabled}
          isRunning={actions.isRunning}
          onUploadFile={actions.handleUploadFile}
          onClearUploadedFile={actions.handleClearUploadedFile}
          onRun={actions.handleRun}
        />
      </div>
    </div>
  )
}

export default PipelineBatchActions
