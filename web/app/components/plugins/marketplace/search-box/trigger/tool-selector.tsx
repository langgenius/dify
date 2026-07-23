import type { Tag } from '../../../hooks'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { PopoverTrigger } from '@langgenius/dify-ui/popover'
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from '#i18n'

type ToolSelectorTriggerProps = {
  selectedTagsLength: number
  open: boolean
  tags: string[]
  tagsMap: Record<string, Tag>
  onTagsChange: (tags: string[]) => void
}

function ToolSelectorTrigger({
  selectedTagsLength,
  open,
  tags,
  tagsMap,
  onTagsChange,
}: ToolSelectorTriggerProps) {
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
    <div className="relative mr-1 inline-flex h-7 max-w-32 shrink-0 items-center">
      <PopoverTrigger
        render={
          <Button
            ref={triggerRef}
            variant="ghost"
            size="small"
            aria-label={triggerLabel}
            className={cn(
              'h-7 max-w-32 justify-start text-text-tertiary focus-visible:ring-inset',
              !selectedTagsLength && 'size-7 min-h-0 justify-center p-0',
              !!selectedTagsLength &&
                'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg py-0.5 pr-7 pl-1 shadow-xs shadow-shadow-shadow-3',
              open && !selectedTagsLength && 'bg-state-base-hover',
            )}
          >
            <span className={cn('shrink-0', !!selectedTagsLength && 'p-0.5')}>
              <span
                aria-hidden
                className={cn(
                  'i-ri-price-tag-3-line block size-4',
                  !!selectedTagsLength && 'text-text-secondary',
                )}
              />
            </span>
            {!!selectedTagsLength && (
              <span className="flex min-w-0 items-center gap-x-0.5 px-0.5 py-1 system-sm-medium">
                <span className="truncate text-text-secondary">
                  {tags
                    .map((tag) => tagsMap[tag]?.label)
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(',')}
                </span>
                {selectedTagsLength > 2 && (
                  <span className="shrink-0 system-xs-medium text-text-tertiary">
                    +{selectedTagsLength - 2}
                  </span>
                )}
              </span>
            )}
          </Button>
        }
      />
      {!!selectedTagsLength && (
        <Button
          variant="ghost"
          size="small"
          aria-label={t(($) => $.clearSelectedTags, {
            ns: 'pluginTags',
            tags: triggerLabel,
          })}
          className="absolute right-0.5 size-6 min-h-0 p-0 focus-visible:ring-inset"
          onClick={() => {
            shouldRestoreFocusRef.current = true
            onTagsChange([])
          }}
        >
          <span aria-hidden className="i-ri-close-circle-fill size-4 text-text-quaternary" />
        </Button>
      )}
    </div>
  )
}

export default memo(ToolSelectorTrigger)
