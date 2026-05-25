'use client'

import type { SortableItem } from '@/app/components/rag-pipeline/components/panel/input-field/field-list/types'
import type { SnippetInputField } from '@/models/snippet'
import { Button } from '@langgenius/dify-ui/button'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import FieldListContainer from '@/app/components/rag-pipeline/components/panel/input-field/field-list/field-list-container'

type SnippetInputFieldPanelProps = {
  fields: SnippetInputField[]
  onClose: () => void
  onAdd: () => void
  onEdit: (field: SnippetInputField) => void
  onRemove: (index: number) => void
  onSortChange: (fields: SnippetInputField[]) => void
}

const toInputFields = (list: SortableItem[]) => {
  return list.map((item) => {
    const { id: _id, chosen: _chosen, selected: _selected, ...field } = item
    return field
  })
}

const SnippetInputFieldPanel = ({
  fields,
  onClose,
  onAdd,
  onEdit,
  onRemove,
  onSortChange,
}: SnippetInputFieldPanelProps) => {
  const { t } = useTranslation('snippet')

  const handleRemove = useCallback((index: number) => {
    onRemove(index)
  }, [onRemove])

  const handleEdit = useCallback((id: string) => {
    const field = fields.find(item => item.variable === id)
    if (field)
      onEdit(field)
  }, [fields, onEdit])

  return (
    <div className="mr-1 flex h-full w-[min(400px,calc(100vw-24px))] flex-col rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <div className="system-xl-semibold text-text-primary">
            {t('panelTitle')}
          </div>
          <div className="pt-1 system-sm-regular text-text-tertiary">
            {t('panelDescription')}
          </div>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover"
          onClick={onClose}
        >
          <span aria-hidden className="i-ri-close-line h-4 w-4" />
        </button>
      </div>

      <div className="px-4 pb-2">
        <Button variant="primary" size="medium" className="gap-0.5 px-3" onClick={onAdd}>
          <span aria-hidden className="i-ri-add-line h-4 w-4" />
          {t('inputFieldPanel.addInputField', { ns: 'datasetPipeline' })}
        </Button>
      </div>

      <div className="flex grow flex-col overflow-y-auto">
        <FieldListContainer
          className="flex flex-col gap-y-1 px-4 py-4"
          inputFields={fields}
          onListSortChange={list => onSortChange(toInputFields(list))}
          onRemoveField={handleRemove}
          onEditField={handleEdit}
        />
      </div>
    </div>
  )
}

export default memo(SnippetInputFieldPanel)
