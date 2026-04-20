'use client'

import type { FormData } from '@/app/components/rag-pipeline/components/panel/input-field/editor/form/types'
import type { SnippetInputField } from '@/models/snippet'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { convertFormDataToINputField, convertToInputFieldFormData } from '@/app/components/rag-pipeline/components/panel/input-field/editor/utils'
import { useFloatingRight } from '@/app/components/rag-pipeline/components/panel/input-field/hooks'
import InputFieldForm from './input-field-form'

type SnippetInputFieldEditorProps = {
  field?: SnippetInputField | null
  onClose: () => void
  onSubmit: (field: SnippetInputField) => void
}

const SnippetInputFieldEditor = ({
  field,
  onClose,
  onSubmit,
}: SnippetInputFieldEditorProps) => {
  const { t } = useTranslation()
  const { floatingRight, floatingRightWidth } = useFloatingRight(400)

  const initialData = useMemo(() => {
    return convertToInputFieldFormData(field || undefined)
  }, [field])

  const handleSubmit = useCallback((value: FormData) => {
    onSubmit(convertFormDataToINputField(value))
  }, [onSubmit])

  return (
    <div
      className={cn(
        'relative mr-1 flex h-fit max-h-full flex-col overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9',
        'transition-all duration-300 ease-in-out',
        floatingRight && 'absolute right-0 z-[100]',
      )}
      style={{
        width: `min(${floatingRightWidth}px, calc(100vw - 24px))`,
      }}
    >
      <div className="system-xl-semibold flex items-center pt-3.5 pr-11 pb-1 pl-4 text-text-primary">
        {field ? t('inputFieldPanel.editInputField', { ns: 'datasetPipeline' }) : t('inputFieldPanel.addInputField', { ns: 'datasetPipeline' })}
      </div>
      <button
        type="button"
        className="absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center"
        onClick={onClose}
      >
        <span aria-hidden className="i-ri-close-line h-4 w-4 text-text-tertiary" />
      </button>
      <InputFieldForm
        initialData={initialData}
        supportFile
        onCancel={onClose}
        onSubmit={handleSubmit}
        isEditMode={!!field}
      />
    </div>
  )
}

export default SnippetInputFieldEditor
