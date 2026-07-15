import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type SnippetTagsFilterProps = {
  embedded?: boolean
  value: string[]
  onChange: (value: string[]) => void
}

const SnippetTagsFilter = ({ embedded = false, value, onChange }: SnippetTagsFilterProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')

  const { data: tagList = [] } = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type: 'snippet',
        },
      },
    }),
  )

  const tagById = useMemo(() => new Map(tagList.map((tag) => [tag.id, tag])), [tagList])
  const filteredTags = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase()
    if (!normalizedSearch) return tagList

    return tagList.filter((tag) => tag.name.toLowerCase().includes(normalizedSearch))
  }, [searchText, tagList])

  const selectedTags = value.flatMap((tagId) => {
    const tag = tagById.get(tagId)
    return tag ? [tag] : []
  })
  const triggerLabel = selectedTags.length
    ? selectedTags.map((tag) => tag.name).join(', ')
    : t(($) => $['tag.placeholder'], { ns: 'common' })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={triggerLabel}
            className={cn(
              'relative flex cursor-pointer items-center justify-center text-text-tertiary select-none',
              embedded
                ? 'h-7 rounded-md p-0.5'
                : 'h-8 min-w-8 rounded-lg border-[0.5px] border-components-panel-border bg-components-input-bg-normal px-2',
              embedded && !value.length && 'py-1 pr-2 pl-1.5',
              embedded &&
                value.length > 0 &&
                'border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg py-0.5 pr-1.5 pl-1 shadow-xs shadow-shadow-shadow-3',
              !embedded && 'hover:bg-components-input-bg-hover',
              open &&
                (embedded
                  ? !value.length && 'bg-state-base-hover'
                  : 'border-components-input-border-active bg-components-input-bg-active text-text-secondary'),
              value.length > 0 && 'text-text-secondary',
            )}
          >
            <span
              className="i-custom-vender-line-financeAndECommerce-tag-01 size-4 text-text-tertiary"
              aria-hidden="true"
            />
            {value.length > 0 && (
              <span className="ml-1 system-xs-medium text-text-secondary">{value.length}</span>
            )}
          </button>
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={6}
        popupClassName="w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-xs"
      >
        <div className="p-2 pb-1">
          <div className="relative">
            <span
              className="absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder"
              aria-hidden="true"
            />
            <Input
              className="pl-6.5"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t(($) => $.searchTags, { ns: 'pluginTags' }) || ''}
            />
          </div>
        </div>
        <CheckboxGroup
          aria-label={t(($) => $.allTags, { ns: 'pluginTags' })}
          value={value}
          onValueChange={onChange}
          className="max-h-112 overflow-y-auto p-1"
        >
          {filteredTags.map((tag) => (
            <label
              key={tag.id}
              className="flex h-7 cursor-pointer items-center rounded-lg px-2 py-1.5 select-none hover:bg-state-base-hover"
            >
              <Checkbox className="mr-1" value={tag.id} />
              <div className="px-1 system-sm-medium text-text-secondary">{tag.name}</div>
            </label>
          ))}
          {!filteredTags.length && (
            <div className="px-3 py-2 system-xs-regular text-text-tertiary">
              {t(($) => $['tag.noTag'], { ns: 'common' })}
            </div>
          )}
        </CheckboxGroup>
      </PopoverContent>
    </Popover>
  )
}

export default SnippetTagsFilter
