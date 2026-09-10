import type { Tag } from '../../../hooks'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverTrigger } from '@langgenius/dify-ui/popover'
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'

type MarketplaceTriggerProps = {
  selectedTagsLength: number
  tags: string[]
  tagsMap: Record<string, Tag>
  onTagsChange: (tags: string[]) => void
}

function MarketplaceTrigger({
  selectedTagsLength,
  tags,
  tagsMap,
  onTagsChange,
}: MarketplaceTriggerProps) {
  const { t } = useTranslation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const shouldRestoreFocusRef = useRef(false)
  const selectedTagLabels = tags.map((tag) => tagsMap[tag]?.label).filter(Boolean)
  const triggerLabel = selectedTagLabels.length
    ? selectedTagLabels.join(', ')
    : t(($) => $.allTags, { ns: 'pluginTags' })

  useEffect(() => {
    if (selectedTagsLength || !shouldRestoreFocusRef.current) return

    shouldRestoreFocusRef.current = false
    triggerRef.current?.focus()
  }, [selectedTagsLength])

  return (
    <div className="relative inline-flex h-8 shrink-0 items-center">
      <PopoverTrigger
        render={
          <Button
            ref={triggerRef}
            variant="ghost"
            size="medium"
            aria-label={triggerLabel}
            className={cn(
              'h-8 justify-start px-2 py-1 text-text-tertiary focus-visible:ring-inset',
              !!selectedTagsLength &&
                'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg pr-8 shadow-xs shadow-shadow-shadow-3',
              !selectedTagsLength && 'data-popup-open:bg-state-base-hover',
            )}
          >
            <span className="py-0.5">
              <span
                aria-hidden
                className={cn(
                  'i-ri-filter-3-line block size-4',
                  !!selectedTagsLength && 'text-text-secondary',
                )}
              />
            </span>
            <span className="flex items-center gap-x-1 py-1 system-sm-medium">
              {!selectedTagsLength && <span>{t(($) => $.allTags, { ns: 'pluginTags' })}</span>}
              {!!selectedTagsLength && (
                <span className="text-text-secondary">
                  {tags
                    .map((tag) => tagsMap[tag]?.label)
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(',')}
                </span>
              )}
              {selectedTagsLength > 2 && (
                <span className="system-xs-medium text-text-tertiary">
                  +{selectedTagsLength - 2}
                </span>
              )}
            </span>
            {!selectedTagsLength && (
              <span className="py-0.5">
                <span
                  aria-hidden
                  className="i-ri-arrow-down-s-line block size-4 text-text-tertiary"
                />
              </span>
            )}
          </Button>
        }
      />
      {!!selectedTagsLength && (
        <IconButton
          variant="ghost"
          size="md"
          aria-label={t(($) => $.clearSelectedTags, {
            ns: 'pluginTags',
            tags: triggerLabel,
          })}
          className="absolute right-1 focus-visible:ring-inset"
          onClick={() => {
            shouldRestoreFocusRef.current = true
            onTagsChange([])
          }}
        >
          <span aria-hidden className="i-ri-close-circle-fill size-4 text-text-quaternary" />
        </IconButton>
      )}
    </div>
  )
}

export default memo(MarketplaceTrigger)
