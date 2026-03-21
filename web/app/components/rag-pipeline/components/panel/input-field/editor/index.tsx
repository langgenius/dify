import type { FormData } from './form/types'
import type { MoreInfo } from '@/app/components/workflow/types'
import type { InputVar } from '@/models/pipeline'
import { RiCloseLine } from '@remixicon/react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { useFloatingRight } from '../hooks'
import InputFieldForm from './form'
import { convertFormDataToINputField, convertToInputFieldFormData } from './utils'

export type InputFieldEditorProps = {
  onClose: () => void
  onSubmit: (data: InputVar, moreInfo?: MoreInfo) => void
  initialData?: InputVar
}

const InputFieldEditorPanel = ({
  onClose,
  onSubmit,
  initialData,
}: InputFieldEditorProps) => {
  const { t } = useTranslation()

  const { floatingRight, floatingRightWidth } = useFloatingRight(400)

  const formData = useMemo(() => {
    return convertToInputFieldFormData(initialData)
  }, [initialData])

  const handleSubmit = useCallback((value: FormData, moreInfo?: MoreInfo) => {
    const inputFieldData = convertFormDataToINputField(value)
    onSubmit(inputFieldData, moreInfo)
  }, [onSubmit])

  return (
    <div
      className={cn(
        'relative mr-1 flex h-fit max-h-full w-[400px] flex-col overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9',
        'transition-all duration-300 ease-in-out',
        floatingRight && 'absolute right-0 z-[100]',
      )}
      style={{
        width: `${floatingRightWidth}px`,
      }}
    >
      <div className="system-xl-semibold flex items-center pb-1 pl-4 pr-11 pt-3.5 text-text-primary">
        {initialData ? t('inputFieldPanel.editInputField', { ns: 'datasetPipeline' }) : t('inputFieldPanel.addInputField', { ns: 'datasetPipeline' })}
      </div>
      <button
        type="button"
        data-testid="input-field-editor-close-btn"
        className="absolute right-2.5 top-2.5 flex size-8 items-center justify-center"
        onClick={onClose}
      >
        <RiCloseLine className="size-4 text-text-tertiary" />
      </button>
      <InputFieldForm
        initialData={formData}
        supportFile
        onCancel={onClose}
        onSubmit={handleSubmit}
        isEditMode={!!initialData}
      />
    </div>
  )
}

export default InputFieldEditorPanel
