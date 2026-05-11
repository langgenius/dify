import type { ComboboxRootProps } from '@langgenius/dify-ui/combobox'
import type { Tag, TagType } from '@/contract/console/tags'
import { cn } from '@langgenius/dify-ui/cn'
import { Combobox, ComboboxContent, ComboboxTrigger } from '@langgenius/dify-ui/combobox'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Tag01Icon from '@/app/components/base/icons/src/vender/line/financeAndECommerce/Tag01'
import XCircleIcon from '@/app/components/base/icons/src/vender/solid/general/XCircle'
import { consoleQuery } from '@/service/client'
import { TagPanel } from './tag-panel'

const tagFilterComboboxFilter: NonNullable<ComboboxRootProps<Tag, true>['filter']> = (tag, query) => tag.name.includes(query)
const tagToString = (tag: Tag) => tag.name
const isSameTag = (item: Tag, value: Tag) => item.id === value.id

type TagFilterProps = {
  type: TagType
  value: string[]
  onChange: (v: string[]) => void
  onOpenTagManagement?: () => void
}
export const TagFilter = ({
  type,
  value,
  onChange,
  onOpenTagManagement = () => {},
}: TagFilterProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const { data: tagList = [] } = useQuery(consoleQuery.tags.list.queryOptions({
    input: {
      query: {
        type,
      },
    },
  }))

  const tagById = useMemo(() => new Map(tagList.map(tag => [tag.id, tag])), [tagList])
  const items = useMemo(() => tagList.filter(tag => tag.type === type), [tagList, type])
  const selectedTags = useMemo(() => {
    return value.flatMap((tagId) => {
      const tag = tagById.get(tagId)
      return tag ? [tag] : []
    })
  }, [tagById, value])

  const firstTagId = value[0]
  const currentTagName = firstTagId ? tagById.get(firstTagId)?.name : undefined
  const triggerLabel = selectedTags.length ? selectedTags.map(tag => tag.name).join(', ') : t('tag.placeholder', { ns: 'common' })
  const handleValueChange = useCallback((nextTags: Tag[]) => {
    const unknownTagIds = value.filter(tagId => !tagById.has(tagId))
    onChange([...unknownTagIds, ...nextTags.map(tag => tag.id)])
  }, [onChange, tagById, value])

  return (
    <Combobox
      open={open}
      onOpenChange={setOpen}
      items={items}
      multiple
      value={selectedTags}
      onValueChange={handleValueChange}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      filter={tagFilterComboboxFilter}
      itemToStringLabel={tagToString}
      isItemEqualToValue={isSameTag}
    >
      <div className="relative">
        <ComboboxTrigger
          aria-label={triggerLabel}
          icon={false}
          className={cn(
            'flex h-8 max-w-60 min-w-28 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 py-0 text-left select-none hover:bg-components-input-bg-normal focus-visible:bg-components-input-bg-normal data-open:bg-components-input-bg-normal',
            !!value.length && 'pr-6 shadow-xs',
          )}
        >
          <span className="flex w-full min-w-0 items-center gap-1">
            <span className="p-px">
              <Tag01Icon className="h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
            </span>
            <span className="min-w-0 grow truncate text-[13px] leading-4.5 text-text-secondary">
              {!value.length && t('tag.placeholder', { ns: 'common' })}
              {!!value.length && currentTagName}
            </span>
            {value.length > 1 && (
              <span className="shrink-0 text-xs leading-4.5 font-medium text-text-tertiary">{`+${value.length - 1}`}</span>
            )}
            {!value.length && (
              <span className="shrink-0 p-px">
                <span aria-hidden className="i-ri-arrow-down-s-line h-3.5 w-3.5 text-text-tertiary" />
              </span>
            )}
          </span>
        </ComboboxTrigger>
        {!!value.length && (
          <button
            type="button"
            aria-label={t('operation.clear', { ns: 'common' })}
            className="group/clear absolute top-1/2 right-2 -translate-y-1/2 border-none bg-transparent p-px"
            onClick={(event) => {
              event.stopPropagation()
              onChange([])
            }}
          >
            <XCircleIcon className="h-3.5 w-3.5 text-text-tertiary group-hover/clear:text-text-secondary" aria-hidden="true" />
          </button>
        )}
        <ComboboxContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
        >
          <TagPanel
            type={type}
            inputValue={inputValue}
            onInputValueChange={setInputValue}
            onOpenTagManagement={onOpenTagManagement}
            onClose={() => setOpen(false)}
          />
        </ComboboxContent>
      </div>
    </Combobox>

  )
}
