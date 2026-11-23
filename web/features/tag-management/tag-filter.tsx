import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { ComboboxPortalProps, ComboboxProps } from '@langgenius/dify-ui/combobox'
import type { RefObject } from 'react'
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
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { TagSearchContent } from './tag-search-content'

const tagFilterComboboxFilter: NonNullable<ComboboxProps<Tag['id'], true, Tag>['filter']> = (
  tag,
  query,
) => tag.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())

type TagFilterProps = {
  iconOnly?: boolean
  /** Embed the trigger as a chip and align its popup with the whole search field. */
  inputGroupRef?: RefObject<HTMLDivElement | null>
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
  inputGroupRef,
  type,
  value,
  onChange,
  onOpenTagManagement = () => {},
  showTagManagement = true,
  showLeadingIcon = true,
  triggerClassName,
  portalProps,
}: TagFilterProps) => {
  const { t } = useTranslation(['common'])
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

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
      <div className="relative min-w-0">
        {inputGroupRef ? (
          <ComboboxTrigger
            ref={triggerRef}
            aria-label={triggerLabel}
            className={cn(
              'flex h-7 max-w-full cursor-pointer items-center gap-1 rounded-md border-[0.5px] border-transparent ps-1.5 pe-2 text-text-tertiary hover:bg-state-base-hover focus-visible:ring-inset data-popup-open:bg-state-base-hover',
              !!value.length &&
                'border-components-button-secondary-border bg-components-button-secondary-bg pe-6 text-text-secondary shadow-xs',
            )}
          >
            <span aria-hidden className="i-ri-price-tag-3-line size-4 shrink-0" />
            {!!value.length && (
              <span className="flex min-w-0 items-center gap-0.5 system-sm-medium">
                <span className="truncate">{currentTagName ?? selectedCountLabel}</span>
                {currentTagName && value.length > 1 && (
                  <span className="shrink-0">+{value.length - 1}</span>
                )}
              </span>
            )}
          </ComboboxTrigger>
        ) : (
          <ComboboxTrigger
            aria-label={triggerLabel}
            className={cn(
              'flex h-8 w-full min-w-0 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal py-0 text-start system-sm-regular whitespace-nowrap select-none',
              iconOnly
                ? 'h-6! w-6! max-w-6! min-w-6! shrink-0 justify-center px-0! py-0!'
                : 'max-w-60 min-w-28 px-2',
              !!value.length && !iconOnly && 'pe-6 shadow-xs',
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
        )}
        {!!value.length && (
          <IconButton
            size="xs"
            aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
            className={cn(
              'group/clear absolute inset-e-2 top-1/2 -translate-y-1/2',
              inputGroupRef && 'inset-e-1.5',
            )}
            onClick={(event) => {
              event.stopPropagation()
              if (inputGroupRef) triggerRef.current?.focus()
              onChange([])
            }}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-3.5 group-hover/clear:text-text-secondary',
                inputGroupRef
                  ? 'i-ri-close-circle-fill text-text-quaternary'
                  : 'i-custom-vender-solid-general-x-circle text-text-tertiary',
              )}
            />
          </IconButton>
        )}
        <ComboboxPortal {...portalProps}>
          <ComboboxPositioner anchor={inputGroupRef}>
            <ComboboxPopup
              aria-label={triggerLabel}
              className={cn(
                'rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]',
                !inputGroupRef && 'w-60',
              )}
            >
              <TagSearchContent
                type={type}
                canBindOrUnbindTags
                allowCreate={false}
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
