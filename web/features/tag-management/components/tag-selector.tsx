import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { ComboboxRootProps } from '@langgenius/dify-ui/combobox'
import type { ComponentProps } from 'react'
import type { TagComboboxItem } from './tag-combobox-item'
import { cn } from '@langgenius/dify-ui/cn'
import { Combobox, ComboboxContent, ComboboxTrigger } from '@langgenius/dify-ui/combobox'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { useApplyTagBindingsMutation } from '../hooks/use-tag-mutations'
import { getTagManagePermissionKey } from '../utils'
import { isCreateTagOption } from './tag-combobox-item'
import { TagSearchContent } from './tag-search-content'
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
  canBindOrUnbindTags?: boolean
  onOpenTagManagement?: () => void
  onTagsChange?: () => void
}

export const TagSelector = ({
  targetId,
  type,
  value,
  canBindOrUnbindTags,
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
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageTags = hasPermission(workspacePermissionKeys, getTagManagePermissionKey(type))

  const applyTagBindingsMutation = useApplyTagBindingsMutation()
  const {
    isPending: isCreatingTag,
    mutate: createTag,
  } = useMutation(consoleQuery.tags.post.mutationOptions())
  const { data: tagList = [] } = useQuery(consoleQuery.tags.get.queryOptions({
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
  const emptyTriggerLabel = canBindOrUnbindTags
    ? t($ => $['tag.addTag'], { ns: 'common' })
    : t($ => $['tag.noTag'], { ns: 'common' })
  const triggerLabel = tagNames.length ? tagNames.join(', ') : emptyTriggerLabel

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

    if (canManageTags && inputValue && nextItems.every(tag => tag.name !== inputValue)) {
      nextItems.push({
        id: `__create_tag__:${inputValue}`,
        name: inputValue,
        type,
        binding_count: '0',
        isCreateOption: true,
      })
    }

    return nextItems
  }, [canManageTags, inputValue, tagList, type, value])

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
        toast.success(t($ => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }), {
          id: toastId,
        })
      },
      onError: () => {
        toast.error(t($ => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }), {
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
    if (!canManageTags || !name || isCreatingTag)
      return

    createTag({
      body: {
        name,
        type,
      },
    }, {
      onSuccess: () => {
        toast.success(t($ => $['tag.created'], { ns: 'common' }))
        setInputValue('')
      },
      onError: () => {
        toast.error(t($ => $['tag.failed'], { ns: 'common' }))
      },
    })
  }, [canManageTags, createTag, isCreatingTag, t, type])

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
        disabled={!canManageTags && !canBindOrUnbindTags}
        aria-label={triggerLabel}
        className={cn(
          'block h-auto w-full rounded-lg border-0 bg-transparent p-0 text-left hover:bg-transparent focus:outline-hidden focus-visible:bg-transparent focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid data-popup-open:bg-state-base-hover data-popup-open:hover:bg-state-base-hover',
        )}
        icon={false}
      >
        <TagTrigger
          tags={tagNames}
          canBindOrUnbindTags={canBindOrUnbindTags}
        />
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
        <TagSearchContent
          type={type}
          inputValue={inputValue}
          onInputValueChange={setInputValue}
          canBindOrUnbindTags={canBindOrUnbindTags}
          onOpenTagManagement={onOpenTagManagement}
          onClose={() => handleOpenChange(false)}
        />
      </ComboboxContent>
    </Combobox>
  )
}
