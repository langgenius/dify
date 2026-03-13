'use client'

import type { SortableItem } from '@/app/components/rag-pipeline/components/panel/input-field/field-list/types'
import type { SnippetInputField } from '@/models/snippet'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import FieldListContainer from '@/app/components/rag-pipeline/components/panel/input-field/field-list/field-list-container'

type SnippetInputFieldPanelProps = {
  fields: SnippetInputField[]
  onClose: () => void
  onAdd: () => void
  onEdit: (field: SnippetInputField) => void
  onRemove: (index: number) => void
  onPrimarySortChange: (fields: SnippetInputField[]) => void
  onSecondarySortChange: (fields: SnippetInputField[]) => void
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
  onPrimarySortChange,
  onSecondarySortChange,
}: SnippetInputFieldPanelProps) => {
  const { t } = useTranslation('snippet')
  const primaryFields = fields.slice(0, 2)
  const secondaryFields = fields.slice(2)

  const handlePrimaryRemove = useCallback((index: number) => {
    onRemove(index)
  }, [onRemove])

  const handleSecondaryRemove = useCallback((index: number) => {
    onRemove(index + primaryFields.length)
  }, [onRemove, primaryFields.length])

  const handlePrimaryEdit = useCallback((id: string) => {
    const field = primaryFields.find(item => item.variable === id)
    if (field)
      onEdit(field)
  }, [onEdit, primaryFields])

  const handleSecondaryEdit = useCallback((id: string) => {
    const field = secondaryFields.find(item => item.variable === id)
    if (field)
      onEdit(field)
  }, [onEdit, secondaryFields])

  return (
    <div className="mr-1 flex h-full w-[min(400px,calc(100vw-24px))] flex-col rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0">
          <div className="text-text-primary system-xl-semibold">
            {t('panelTitle')}
          </div>
          <div className="pt-1 text-text-tertiary system-sm-regular">
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
        <Button variant="secondary" size="small" className="w-full justify-center gap-1" onClick={onAdd}>
          <span aria-hidden className="i-ri-add-line h-4 w-4" />
          {t('inputFieldPanel.addInputField', { ns: 'datasetPipeline' })}
        </Button>
      </div>

      <div className="flex grow flex-col overflow-y-auto">
        <div className="px-4 pb-1 pt-2 text-text-secondary system-xs-semibold-uppercase">
          {t('panelPrimaryGroup')}
        </div>
        <FieldListContainer
          className="flex flex-col gap-y-1 px-4 pb-2"
          inputFields={primaryFields}
          onListSortChange={list => onPrimarySortChange(toInputFields(list))}
          onRemoveField={handlePrimaryRemove}
          onEditField={handlePrimaryEdit}
        />

        <div className="px-4 py-2">
          <Divider type="horizontal" className="bg-divider-subtle" />
        </div>

        <div className="px-4 pb-1 text-text-secondary system-xs-semibold-uppercase">
          {t('panelSecondaryGroup')}
        </div>
        <FieldListContainer
          className="flex flex-col gap-y-1 px-4 pb-4"
          inputFields={secondaryFields}
          onListSortChange={list => onSecondarySortChange(toInputFields(list))}
          onRemoveField={handleSecondaryRemove}
          onEditField={handleSecondaryEdit}
        />
      </div>
    </div>
  )
}

export default memo(SnippetInputFieldPanel)
