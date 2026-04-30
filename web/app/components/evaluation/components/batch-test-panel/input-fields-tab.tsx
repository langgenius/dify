import type { EvaluationResourceProps } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { EVALUATION_TEMPLATE_FILE_NAMES } from '../../store-utils'
import InputFieldsRequirements from './input-fields/input-fields-requirements'
import UploadRunPopover from './input-fields/upload-run-popover'
import { useInputFieldsActions } from './input-fields/use-input-fields-actions'
import { usePublishedInputFields } from './input-fields/use-published-input-fields'

type InputFieldsTabProps = EvaluationResourceProps & {
  isPanelReady: boolean
  isRunnable: boolean
}

const InputFieldsTab = ({
  resourceType,
  resourceId,
  isPanelReady,
  isRunnable,
}: InputFieldsTabProps) => {
  const { t } = useTranslation('evaluation')
  const { inputFields, isInputFieldsLoading } = usePublishedInputFields(resourceType, resourceId)
  const actions = useInputFieldsActions({
    resourceType,
    resourceId,
    inputFields,
    isInputFieldsLoading,
    isPanelReady,
    isRunnable,
    templateFileName: EVALUATION_TEMPLATE_FILE_NAMES[resourceType],
  })

  return (
    <div className="space-y-5">
      <InputFieldsRequirements
        resourceType={resourceType}
        inputFields={inputFields}
        isLoading={isInputFieldsLoading}
      />
      <div className="space-y-3">
        <Button variant="secondary" className="w-full justify-center" disabled={!actions.canDownloadTemplate} onClick={actions.handleDownloadTemplate}>
          <span aria-hidden="true" className="mr-1 i-ri-download-line h-4 w-4" />
          {t('batch.downloadTemplate')}
        </Button>
        <UploadRunPopover
          open={actions.isUploadPopoverOpen}
          onOpenChange={actions.setIsUploadPopoverOpen}
          triggerDisabled={actions.uploadButtonDisabled}
          inputFields={inputFields}
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
      {!isRunnable && (
        <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary">
          {t('batch.validation')}
        </div>
      )}
    </div>
  )
}

export default InputFieldsTab
