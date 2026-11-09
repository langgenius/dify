'use client'

import type { KnowledgeBaseOption } from './knowledge-base-options'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useTranslation } from 'react-i18next'

/**
 * Which knowledge bases a connection may read. Bases whose managers turned personal agents off
 * are listed but cannot be chosen.
 */
export function KnowledgeBasePicker({
  blocked,
  disabled,
  hasMore,
  loadingMore,
  onChange,
  onLoadMore,
  options,
  value,
}: {
  blocked: ReadonlySet<string>
  disabled?: boolean
  hasMore?: boolean
  loadingMore?: boolean
  onChange: (value: string[]) => void
  onLoadMore?: () => void
  options: readonly KnowledgeBaseOption[]
  value: readonly string[]
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const selectable = options.filter((option) => !blocked.has(option.id))
  const selected = new Set(value)
  const selectedCount = selectable.filter((option) => selected.has(option.id)).length

  if (options.length === 0) {
    return (
      <p className="rounded-lg bg-background-section px-3 py-2 body-xs-regular text-text-tertiary">
        {t(($) => $['agents.noKnowledgeBases'])}
      </p>
    )
  }
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" disabled={disabled}>
      <legend className="sr-only">{t(($) => $['agents.knowledgeBases'])}</legend>
      <label className="flex w-fit items-center gap-2 px-1 py-1 system-sm-medium text-text-secondary">
        <Checkbox
          checked={selectable.length > 0 && selectedCount === selectable.length}
          indeterminate={selectedCount > 0 && selectedCount < selectable.length}
          disabled={disabled || selectable.length === 0}
          onCheckedChange={(checked) =>
            onChange(checked ? selectable.map((option) => option.id) : [])
          }
        />
        {t(($) => $['agents.selectAll'])}
      </label>
      <div className="max-h-60 overflow-y-auto rounded-lg border-[0.5px] border-components-panel-border">
        {options.map((option) => {
          const isBlocked = blocked.has(option.id)
          return (
            <label
              key={option.id}
              className="flex items-start gap-2 border-b-[0.5px] border-divider-subtle px-3 py-2 last:border-b-0 has-disabled:cursor-not-allowed"
            >
              <Checkbox
                className="mt-0.5 shrink-0"
                checked={selected.has(option.id)}
                disabled={disabled || isBlocked}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...value, option.id] : value.filter((id) => id !== option.id))
                }
              />
              <span className="min-w-0">
                <span
                  className={
                    isBlocked
                      ? 'block truncate system-sm-medium text-text-quaternary'
                      : 'block truncate system-sm-medium text-text-secondary'
                  }
                >
                  {option.name}
                </span>
                {isBlocked ? (
                  <span className="block system-xs-regular text-text-tertiary">
                    {t(($) => $['agents.knowledgeBaseBlocked'])}
                  </span>
                ) : (
                  option.description && (
                    <span className="block truncate system-xs-regular text-text-tertiary">
                      {option.description}
                    </span>
                  )
                )}
              </span>
            </label>
          )
        })}
        {hasMore && (
          <div className="flex justify-center p-2">
            <Button size="small" variant="ghost" loading={loadingMore} onClick={onLoadMore}>
              {t(($) => $.loadMore)}
            </Button>
          </div>
        )}
      </div>
    </fieldset>
  )
}
