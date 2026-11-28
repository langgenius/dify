'use client'

import type { KnowledgeBaseOption } from './knowledge-base-options'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useTranslation } from 'react-i18next'
import { KnowledgeSpaceIcon } from '../components/knowledge-space-icon'

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
    <fieldset
      className="flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-divider-subtle"
      disabled={disabled}
    >
      <legend className="sr-only">{t(($) => $['agents.knowledgeBases'])}</legend>
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-divider-subtle px-3">
        <label className="flex min-w-0 items-center gap-2 system-xs-medium text-text-primary">
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
        <span className="shrink-0 system-xs-regular text-text-tertiary" aria-live="polite">
          {t(($) => $['agents.selectedCount'], {
            selected: selectedCount,
            total: selectable.length,
          })}
        </span>
      </div>
      <div className="max-h-45 overflow-y-auto">
        {options.map((option) => {
          const isBlocked = blocked.has(option.id)
          return (
            <label
              key={option.id}
              className="flex min-h-9 items-center gap-2 px-3 py-1.5 has-disabled:cursor-not-allowed"
            >
              <Checkbox
                className="shrink-0"
                checked={selected.has(option.id)}
                disabled={disabled || isBlocked}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...value, option.id] : value.filter((id) => id !== option.id))
                }
              />
              <span aria-hidden className={isBlocked ? 'shrink-0 opacity-50' : 'shrink-0'}>
                <KnowledgeSpaceIcon
                  background={option.iconBackground}
                  icon={option.icon}
                  size="tiny"
                />
              </span>
              <span className="min-w-0">
                <span
                  className={
                    isBlocked
                      ? 'block truncate system-sm-regular text-text-quaternary'
                      : 'block truncate system-sm-regular text-text-primary'
                  }
                >
                  {option.name}
                </span>
                {isBlocked && (
                  <span className="block system-xs-regular text-text-tertiary">
                    {t(($) => $['agents.knowledgeBaseBlocked'])}
                  </span>
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
