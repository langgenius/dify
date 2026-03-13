'use client'

import type { FormData } from '@/app/components/rag-pipeline/components/panel/input-field/editor/form/types'
import type { SnippetInputField } from '@/models/snippet'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import InputFieldForm from '@/app/components/rag-pipeline/components/panel/input-field/editor/form'
import { convertFormDataToINputField, convertToInputFieldFormData } from '@/app/components/rag-pipeline/components/panel/input-field/editor/utils'

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

  const initialData = useMemo(() => {
    return convertToInputFieldFormData(field || undefined)
  }, [field])

  const handleSubmit = useCallback((value: FormData) => {
    onSubmit(convertFormDataToINputField(value))
  }, [onSubmit])

  return (
    <div className="relative mr-1 flex h-fit max-h-full w-[min(400px,calc(100vw-24px))] flex-col overflow-y-auto rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9">
      <div className="flex items-center pb-1 pl-4 pr-11 pt-3.5 text-text-primary system-xl-semibold">
        {field ? t('inputFieldPanel.editInputField', { ns: 'datasetPipeline' }) : t('inputFieldPanel.addInputField', { ns: 'datasetPipeline' })}
      </div>
      <button
        type="button"
        className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center"
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
