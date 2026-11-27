import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { ComboboxPortalProps, ComboboxProps } from '@langgenius/dify-ui/combobox'
import type { PopoverPortalProps } from '@langgenius/dify-ui/popover'
import type { UseQueryResult } from '@tanstack/react-query'
import { Button } from '@langgenius/dify-ui/button'
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
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { CompactTagFilterTrigger } from './compact-tag-filter-trigger'
import { TagFilterPopover } from './tag-filter-popover'
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
function useWorkspaceTags(type: TagType) {
  const query = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type,
        },
      },
    }),
  )
  return { data: query.data, query }
}

// A failed load must not look like a workspace without tags. Rendered inside the open popup, so
// the failed first load is claimed only while it is shown.
function TagsLoadError({
  query,
  className,
}: {
  query: UseQueryResult<unknown>
  className: string
}) {
  const { t } = useTranslation(['common'])
  const load = useOwnedQueryError(query)
  const message = useRequestErrorMessage(
    load?.error,
    t(($) => $['dynamicSelect.error'], { ns: 'common' }),
  )
  if (!load) return null

  return (
    <div role="alert" className={cn('flex items-center gap-2', className)}>
      <span className="min-w-0 flex-1 system-xs-regular text-text-tertiary">{message}</span>
      <Button size="small" variant="ghost" loading={load.retrying} onClick={load.retry}>
        {t(($) => $['operation.retry'], { ns: 'common' })}
      </Button>
    </div>
  )
}

export function CompactTagFilter({
  type,
  value,
  onChange,
  container,
}: Pick<TagFilterProps, 'type' | 'value' | 'onChange'> & {
  container?: PopoverPortalProps['container']
}) {
  const { t } = useTranslation(['common'])
  const { data: tagList = [], query: tagsQuery } = useWorkspaceTags(type)
  const options = tagList
    .filter((tag) => tag.type === type)
    .map((tag) => ({ name: tag.id, label: tag.name }))
  const names = new Map(options.map(({ name, label }) => [name, label]))
  const selectedLabels = value.flatMap((id) => names.get(id) ?? [])
  const placeholder = t(($) => $['tag.placeholder'], { ns: 'common' })
  const label =
    value.length && selectedLabels.length !== value.length
      ? t(($) => $['dynamicSelect.selected'], { ns: 'common', count: value.length })
      : selectedLabels.join(', ') || placeholder
  return (
    <TagFilterPopover
      options={options}
      value={value}
      onValueChange={onChange}
      label={placeholder}
      searchLabel={t(($) => $['tag.searchTags'], { ns: 'common' })}
      // Without loaded tags there is nothing to call empty; a failed load shows its own state.
      emptyText={
        tagsQuery.data === undefined ? undefined : t(($) => $['tag.noTag'], { ns: 'common' })
      }
      loadError={<TagsLoadError query={tagsQuery} className="p-3" />}
      container={container}
    >
      <CompactTagFilterTrigger
        selectedLabels={selectedLabels}
        selectedCount={value.length}
        label={label}
        clearLabel={t(($) => $['operation.clear'], { ns: 'common' })}
        onClear={() => onChange([])}
      />
    </TagFilterPopover>
  )
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
  const { t } = useTranslation(['common'])
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const { data: tagList = [], query: tagsQuery } = useWorkspaceTags(type)

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
        {!!value.length && (
          <IconButton
            size="xs"
            aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
            className="group/clear absolute inset-e-2 top-1/2 -translate-y-1/2"
            onClick={(event) => {
              event.stopPropagation()
              onChange([])
            }}
          >
            <span
              aria-hidden="true"
              className="i-custom-vender-solid-general-x-circle size-3.5 text-text-tertiary group-hover/clear:text-text-secondary"
            />
          </IconButton>
        )}
        <ComboboxPortal {...portalProps}>
          <ComboboxPositioner>
            <ComboboxPopup
              aria-label={triggerLabel}
              className="w-60 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
            >
              <TagsLoadError query={tagsQuery} className="px-3 pt-2" />
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
