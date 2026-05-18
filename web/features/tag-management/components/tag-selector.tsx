import type { ComboboxRootProps } from '@langgenius/dify-ui/combobox'
import type { ComponentProps } from 'react'
import type { TagComboboxItem } from './tag-combobox-item'
import type { Tag, TagType } from '@/contract/console/tags'
import { cn } from '@langgenius/dify-ui/cn'
import { Combobox, ComboboxContent, ComboboxTrigger } from '@langgenius/dify-ui/combobox'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { useApplyTagBindingsMutation } from '../hooks/use-tag-mutations'
import { isCreateTagOption } from './tag-combobox-item'
import { TagPanel } from './tag-panel'
import { TagTrigger } from './tag-trigger'

const TAG_COMBOBOX_FILTER: NonNullable<ComboboxRootProps<TagComboboxItem, true>['filter']> = (tag, query) => tag.name.includes(query)
const tagToString = (tag: TagComboboxItem) => tag.name
const isSameTag = (item: TagComboboxItem, value: TagComboboxItem) => item.id === value.id

type TagSelectorRootProps = Omit<
  ComboboxRootProps<TagComboboxItem, true>,
  | 'items'
  | 'multiple'
  | 'value'
  | 'defaultValue'
  | 'onValueChange'
  | 'inputValue'
  | 'defaultInputValue'
  | 'onInputValueChange'
  | 'filter'
  | 'itemToStringLabel'
  | 'isItemEqualToValue'
  | 'open'
  | 'defaultOpen'
  | 'onOpenChange'
  | 'onOpenChangeComplete'
  | 'children'
>
type TagSelectorContentProps = Pick<ComponentProps<typeof ComboboxContent>, 'placement' | 'sideOffset' | 'alignOffset' | 'portalProps' | 'positionerProps' | 'popupProps' | 'popupClassName'>

type TagSelectorProps = TagSelectorRootProps & TagSelectorContentProps & {
  targetId: string
  type: TagType
  value: Tag[]
  onOpenTagManagement?: () => void
  onTagsChange?: () => void
}

export const TagSelector = ({
  targetId,
  type,
  value,
  onOpenTagManagement = () => {},
  onTagsChange,
  placement = 'bottom-start',
  sideOffset = 4,
  alignOffset = 0,
  portalProps,
  positionerProps,
  popupProps,
  popupClassName,
  ...rootProps
}: TagSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftTags, setDraftTags] = useState<Tag[]>(value)
  const [inputValue, setInputValue] = useState('')
  const applyTagBindingsMutation = useApplyTagBindingsMutation()
  const {
    isPending: isCreatingTag,
    mutate: createTag,
  } = useMutation(consoleQuery.tags.create.mutationOptions())
  const { data: tagList = [] } = useQuery(consoleQuery.tags.list.queryOptions({
    input: {
      query: {
        type,
      },
    },
  }))

  const selectedTagIds = useMemo(() => value.map(tag => tag.id), [value])
  const tagNames = useMemo(() => {
    if (!value.length)
      return []

    const tagNameById = new Map(tagList.map(tag => [tag.id, tag.name]))
    return value.flatMap((tag) => {
      const tagName = tagNameById.get(tag.id)
      return tagName ? [tagName] : []
    })
  }, [tagList, value])
  const triggerLabel = tagNames.length ? tagNames.join(', ') : t('tag.addTag', { ns: 'common' })

  const items = useMemo<TagComboboxItem[]>(() => {
    const tagIds = new Set<string>()
    const nextItems: TagComboboxItem[] = []

    for (const tag of tagList) {
      if (tag.type !== type)
        continue

      tagIds.add(tag.id)
      nextItems.push(tag)
    }

    for (const tag of value) {
      if (tag.type === type && !tagIds.has(tag.id))
        nextItems.push(tag)
    }

    if (inputValue && nextItems.every(tag => tag.name !== inputValue)) {
      nextItems.push({
        id: `__create_tag__:${inputValue}`,
        name: inputValue,
        type,
        binding_count: 0,
        isCreateOption: true,
      })
    }

    return nextItems
  }, [inputValue, tagList, type, value])

  const applyTagBindings = useCallback(() => {
    const draftTagIds = draftTags.map(tag => tag.id)
    const draftTagIdSet = new Set(draftTagIds)
    const tagSelectionChanged = selectedTagIds.length !== draftTagIds.length
      || selectedTagIds.some(tagId => !draftTagIdSet.has(tagId))

    if (!tagSelectionChanged)
      return

    const toastId = `tag-bindings-${type}-${targetId}`

    applyTagBindingsMutation.mutate({
      currentTagIds: selectedTagIds,
      nextTagIds: draftTagIds,
      targetId,
      type,
    }, {
      onSuccess: () => {
        toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }), {
          id: toastId,
        })
      },
      onError: () => {
        toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }), {
          id: toastId,
        })
      },
      onSettled: () => {
        onTagsChange?.()
      },
    })
  }, [applyTagBindingsMutation, draftTags, onTagsChange, selectedTagIds, t, targetId, type])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setDraftTags(value)
    }
    else {
      applyTagBindings()
    }

    setOpen(nextOpen)
  }, [applyTagBindings, value])

  const createNewTag = useCallback((name: string) => {
    if (!name || isCreatingTag)
      return

    createTag({
      body: {
        name,
        type,
      },
    }, {
      onSuccess: () => {
        toast.success(t('tag.created', { ns: 'common' }))
        setInputValue('')
      },
      onError: () => {
        toast.error(t('tag.failed', { ns: 'common' }))
      },
    })
  }, [createTag, isCreatingTag, t, type])

  const handleValueChange = useCallback((nextTags: TagComboboxItem[]) => {
    const createOption = nextTags.find(isCreateTagOption)
    if (createOption) {
      createNewTag(createOption.name)
      return
    }

    setDraftTags(nextTags.filter(tag => !isCreateTagOption(tag)))
  }, [createNewTag])

  return (
    <Combobox
      {...rootProps}
      open={open}
      onOpenChange={handleOpenChange}
      items={items}
      multiple
      value={draftTags}
      onValueChange={handleValueChange}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      filter={TAG_COMBOBOX_FILTER}
      itemToStringLabel={tagToString}
      isItemEqualToValue={isSameTag}
    >
      <ComboboxTrigger
        aria-label={triggerLabel}
        className={cn(
          open ? 'bg-state-base-hover' : 'bg-transparent',
          'block h-auto w-full rounded-lg border-0 bg-transparent p-0 text-left hover:bg-transparent focus:outline-hidden focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:ring-inset data-open:bg-state-base-hover data-open:hover:bg-state-base-hover',
        )}
        icon={false}
      >
        <TagTrigger tags={tagNames} />
      </ComboboxTrigger>
      <ComboboxContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        portalProps={portalProps}
        positionerProps={positionerProps}
        popupProps={popupProps}
        popupClassName={cn('w-(--anchor-width) min-w-60 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]', popupClassName)}
      >
        <TagPanel
          type={type}
          inputValue={inputValue}
          onInputValueChange={setInputValue}
          onOpenTagManagement={onOpenTagManagement}
          onClose={() => handleOpenChange(false)}
        />
      </ComboboxContent>
    </Combobox>
  )
}
