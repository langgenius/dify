import type { EvaluationFieldOption } from '../../types'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { toast } from '@/app/components/base/ui/toast'

type InputFieldsTabProps = {
  requirementFields: EvaluationFieldOption[]
  templateFileName: string
  uploadedFileName: string | null
  isPanelReady: boolean
  isRunnable: boolean
  onRun: () => void
  onUploadFileNameChange: (uploadedFileName: string | null) => void
}

const InputFieldsTab = ({
  requirementFields,
  templateFileName,
  uploadedFileName,
  isPanelReady,
  isRunnable,
  onRun,
  onUploadFileNameChange,
}: InputFieldsTabProps) => {
  const { t } = useTranslation('evaluation')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDownloadTemplate = () => {
    const content = ['case_id,input,expected', '1,Example input,Example output'].join('\n')
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`
    link.download = templateFileName
    link.click()
  }

  const handleRun = () => {
    if (!isRunnable) {
      toast.warning(t('batch.validation'))
      return
    }

    onRun()
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="system-md-semibold text-text-primary">{t('batch.requirementsTitle')}</div>
        <div className="mt-1 system-xs-regular text-text-tertiary">{t('batch.requirementsDescription')}</div>
        <div className="mt-3 rounded-xl bg-background-section p-3">
          {requirementFields.map(field => (
            <div key={field.id} className="flex items-center py-1">
              <div className="rounded px-1 py-0.5 system-xs-medium text-text-tertiary">
                {field.label}
              </div>
              <div className="text-[10px] leading-3 text-text-quaternary">
                {field.type}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Button variant="secondary" className="w-full justify-center" disabled={!isPanelReady} onClick={handleDownloadTemplate}>
          <span aria-hidden="true" className="mr-1 i-ri-download-line h-4 w-4" />
          {t('batch.downloadTemplate')}
        </Button>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".csv,.xlsx"
          onChange={(event) => {
            const file = event.target.files?.[0]
            onUploadFileNameChange(file?.name ?? null)
          }}
        />
        {isPanelReady && (
          <button
            type="button"
            className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-divider-subtle bg-background-default-subtle px-4 py-6 text-center hover:border-components-button-secondary-border"
            onClick={() => fileInputRef.current?.click()}
          >
            <span aria-hidden="true" className="i-ri-file-upload-line h-5 w-5 text-text-tertiary" />
            <div className="mt-2 system-sm-semibold text-text-primary">{t('batch.uploadTitle')}</div>
            <div className="mt-1 system-xs-regular text-text-tertiary">{uploadedFileName ?? t('batch.uploadHint')}</div>
          </button>
        )}
      </div>
      {!isRunnable && (
        <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary">
          {t('batch.validation')}
        </div>
      )}
      <Button className="w-full justify-center" variant="primary" disabled={!isRunnable} onClick={handleRun}>
        {t('batch.run')}
      </Button>
    </div>
  )
}

export default InputFieldsTab
