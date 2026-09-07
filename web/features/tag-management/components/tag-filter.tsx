import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { ComboboxPortalProps, ComboboxProps } from '@langgenius/dify-ui/combobox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import XCircleIcon from '@/app/components/base/icons/src/vender/solid/general/XCircle'
import { consoleQuery } from '@/service/client'
import { TagSearchContent } from './tag-search-content'

const tagFilterComboboxFilter: NonNullable<ComboboxProps<Tag['id'], true, Tag>['filter']> = (
  tag,
  query,
) => tag.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())

type TagFilterProps = {
  iconOnly?: boolean
  type: TagType
  value: string[]
  onChange: (v: string[]) => void
  onOpenTagManagement?: () => void
  portalProps?: ComboboxPortalProps
  showTagManagement?: boolean
  showLeadingIcon?: boolean
  triggerClassName?: string
}
export const TagFilter = ({
  iconOnly = false,
  type,
  value,
  onChange,
  onOpenTagManagement = () => {},
  showTagManagement = true,
  showLeadingIcon = true,
  triggerClassName,
  portalProps,
}: TagFilterProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const { data: tagList = [] } = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type,
        },
      },
    }),
  )

  const tagById = useMemo(() => new Map(tagList.map((tag) => [tag.id, tag])), [tagList])
  const tagOptions = useMemo(() => tagList.filter((tag) => tag.type === type), [tagList, type])
  const tagItems = useMemo(
    () =>
      createComboboxItems(tagOptions, {
        getValue: (tag) => tag.id,
        getLabel: (tag) => tag.name,
      }),
    [tagOptions],
  )
  const selectedTags = useMemo(() => {
    return value.flatMap((tagId) => {
      const tag = tagById.get(tagId)
      return tag ? [tag] : []
    })
  }, [tagById, value])

  const firstTagId = value[0]
  const currentTagName = firstTagId ? tagById.get(firstTagId)?.name : undefined
  const placeholderLabel = t(($) => $['tag.placeholder'], { ns: 'common' })
  const selectedCountLabel = t(($) => $['dynamicSelect.selected'], {
    ns: 'common',
    count: value.length,
  })
  const triggerLabel = value.length
    ? selectedTags.length === value.length
      ? selectedTags.map((tag) => tag.name).join(', ')
      : selectedCountLabel
    : placeholderLabel

  return (
    <Combobox<Tag['id'], true, Tag>
      open={open}
      onOpenChange={setOpen}
      items={tagItems}
      multiple
      value={value}
      onValueChange={(nextValue) => onChange(nextValue)}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      filter={tagFilterComboboxFilter}
    >
      <div className="relative">
        <ComboboxTrigger
          aria-label={triggerLabel}
          icon={false}
          className={cn(
            'flex h-8 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal py-0 text-left whitespace-nowrap select-none hover:bg-components-input-bg-normal focus-visible:bg-components-input-bg-normal data-popup-open:bg-components-input-bg-normal',
            iconOnly
              ? 'h-6! w-6! max-w-6! min-w-6! shrink-0 justify-center px-0! py-0! [&>span:first-child]:flex [&>span:first-child]:grow-0'
              : 'max-w-60 min-w-28 px-2',
            !!value.length && !iconOnly && 'pr-6 shadow-xs',
            triggerClassName,
          )}
        >
          {iconOnly ? (
            <span
              aria-hidden
              className={cn(
                'i-ri-price-tag-3-line size-4',
                value.length ? 'text-text-accent' : 'text-text-tertiary',
              )}
            />
          ) : (
            <span className="flex w-full min-w-0 items-center gap-1">
              {showLeadingIcon && (
                <span className="p-px">
                  <span
                    className="i-custom-vender-line-financeAndECommerce-tag-01 size-3.5 text-text-tertiary"
                    aria-hidden="true"
                  />
                </span>
              )}
              <span className="min-w-0 grow truncate text-[13px] leading-4.5 text-text-tertiary">
                {!value.length && placeholderLabel}
                {!!value.length && (currentTagName ?? selectedCountLabel)}
              </span>
              {currentTagName && value.length > 1 && (
                <span className="shrink-0 text-xs/4.5 font-medium text-text-tertiary">{`+${value.length - 1}`}</span>
              )}
              {!value.length && (
                <span className="shrink-0 p-px">
                  <span
                    aria-hidden
                    className="i-ri-arrow-down-s-line size-3.5 text-text-tertiary"
                  />
                </span>
              )}
            </span>
          )}
        </ComboboxTrigger>
        {!!value.length && (
          <IconButton
            size="xs"
            aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
            className="group/clear absolute top-1/2 right-2 -translate-y-1/2"
            onClick={(event) => {
              event.stopPropagation()
              onChange([])
            }}
          >
            <XCircleIcon
              className="size-3.5 text-text-tertiary group-hover/clear:text-text-secondary"
              aria-hidden="true"
            />
          </IconButton>
        )}
        <ComboboxPortal {...portalProps}>
          <ComboboxPositioner placement="bottom-start" sideOffset={4}>
            <ComboboxPopup
              aria-label={triggerLabel}
              className="w-60 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
            >
              <TagSearchContent
                type={type}
                inputValue={inputValue}
                onInputValueChange={setInputValue}
                canBindOrUnbindTags
                onOpenTagManagement={onOpenTagManagement}
                showTagManagement={showTagManagement}
                onClose={() => setOpen(false)}
              />
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </div>
    </Combobox>
  )
}
