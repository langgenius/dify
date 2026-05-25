'use client'

import type { SortableItem } from '@/app/components/rag-pipeline/components/panel/input-field/field-list/types'
import type { SnippetDetail, SnippetInputField } from '@/models/snippet'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import FieldListContainer from '@/app/components/rag-pipeline/components/panel/input-field/field-list/field-list-container'
import Link from '@/next/link'

type SnippetSidebarProps = {
  snippet: SnippetDetail
  fields: SnippetInputField[]
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

const SnippetSidebar = ({
  snippet,
  fields,
  onAdd,
  onEdit,
  onRemove,
  onSortChange,
}: SnippetSidebarProps) => {
  const { t } = useTranslation('snippet')

  const handleEdit = useCallback((id: string) => {
    const field = fields.find(item => item.variable === id)
    if (field)
      onEdit(field)
  }, [fields, onEdit])

  return (
    <aside className="flex h-full w-90 shrink-0 flex-col border-r border-divider-subtle bg-background-default">
      <div className="shrink-0 px-6 pt-7">
        <Link
          href="/snippets"
          className="inline-flex items-center gap-2 system-sm-semibold-uppercase text-text-primary hover:text-text-accent"
        >
          <span aria-hidden className="i-ri-arrow-left-line h-4 w-4" />
          {t('management')}
        </Link>

        <div className="mt-12">
          <div className="min-w-0">
            <div className="system-xl-semibold text-text-primary">{snippet.name}</div>
            {!!snippet.description && (
              <div className="mt-3 system-sm-regular text-text-tertiary">
                {snippet.description}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-6 mt-7 h-px shrink-0 bg-divider-subtle" />

      <div className="flex min-h-0 grow flex-col px-6 pt-7">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="system-sm-semibold-uppercase text-text-secondary">
              {t('inputVariables')}
            </span>
            <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary" />
          </div>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
            aria-label={t('inputFieldPanel.addInputField', { ns: 'datasetPipeline' })}
            onClick={onAdd}
          >
            <span aria-hidden className="i-ri-add-line h-4 w-4" />
          </button>
        </div>
        <FieldListContainer
          className="flex min-h-0 flex-col gap-y-1 overflow-y-auto pb-6"
          inputFields={fields}
          onListSortChange={list => onSortChange(toInputFields(list))}
          onRemoveField={onRemove}
          onEditField={handleEdit}
        />
      </div>
    </aside>
  )
}

export default memo(SnippetSidebar)
