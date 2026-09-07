import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { ComboboxProps, ComboboxTriggerProps } from '@langgenius/dify-ui/combobox'
import type { TagComboboxItem } from './tag-combobox-item'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
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
import { TagTriggerContent } from './tag-trigger-content'

const normalizeTagName = (name: string) => name.trim().toLocaleLowerCase()
const TAG_COMBOBOX_FILTER: NonNullable<
  ComboboxProps<TagComboboxItem['id'], true, TagComboboxItem>['filter']
> = (tag, query) => normalizeTagName(tag.name).includes(normalizeTagName(query))

type TagSelectorRootProps = Omit<
  ComboboxProps<TagComboboxItem['id'], true, TagComboboxItem>,
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
  | 'itemToStringValue'
  | 'isItemEqualToValue'
  | 'open'
  | 'defaultOpen'
  | 'onOpenChange'
  | 'onOpenChangeComplete'
  | 'children'
>
export type TagSelectorProps = TagSelectorRootProps &
  Pick<ComboboxTriggerProps, 'className' | 'onClick'> & {
    targetId: string
    contextLabel?: string
    type: TagType
    value: Tag[]
    canBindOrUnbindTags?: boolean
    onOpenTagManagement?: () => void
    onTagsChange?: () => void
  }

export const TagSelector = ({
  targetId,
  contextLabel,
  type,
  value,
  canBindOrUnbindTags,
  className,
  onClick,
  onOpenTagManagement = () => {},
  onTagsChange,
  ...rootProps
}: TagSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftTagIds, setDraftTagIds] = useState(() => value.map((tag) => tag.id))
  const [inputValue, setInputValue] = useState('')
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageTags = hasPermission(workspacePermissionKeys, getTagManagePermissionKey(type))

  const applyTagBindingsMutation = useApplyTagBindingsMutation()
  const { isPending: isCreatingTag, mutate: createTag } = useMutation(
    consoleQuery.tags.post.mutationOptions(),
  )
  const { data: tagList = [] } = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type,
        },
      },
    }),
  )

  const selectedTagIds = useMemo(() => value.map((tag) => tag.id), [value])
  const tagNames = useMemo(() => {
    if (!value.length) return []

    const tagNameById = new Map(tagList.map((tag) => [tag.id, tag.name]))
    return value.flatMap((tag) => {
      const tagName = tagNameById.get(tag.id)
      return tagName ? [tagName] : []
    })
  }, [tagList, value])
  const emptyTriggerLabel = canBindOrUnbindTags
    ? t(($) => $['tag.addTag'], { ns: 'common' })
    : t(($) => $['tag.noTag'], { ns: 'common' })
  const triggerLabel = tagNames.length ? tagNames.join(', ') : emptyTriggerLabel
  const accessibleTriggerLabel = contextLabel ? `${triggerLabel}: ${contextLabel}` : triggerLabel

  const items = useMemo<TagComboboxItem[]>(() => {
    const tagIds = new Set<string>()
    const nextItems: TagComboboxItem[] = []
    const normalizedInputValue = normalizeTagName(inputValue)

    for (const tag of tagList) {
      if (tag.type !== type) continue

      tagIds.add(tag.id)
      nextItems.push(tag)
    }

    for (const tag of value) {
      if (tag.type === type && !tagIds.has(tag.id)) {
        tagIds.add(tag.id)
        nextItems.push(tag)
      }
    }

    if (
      canManageTags &&
      normalizedInputValue &&
      nextItems.every((tag) => normalizeTagName(tag.name) !== normalizedInputValue)
    ) {
      const trimmedInputValue = inputValue.trim()
      nextItems.push({
        id: `__create_tag__:${trimmedInputValue}`,
        name: trimmedInputValue,
        type,
        binding_count: '0',
        isCreateOption: true,
      })
    }

    return nextItems
  }, [canManageTags, inputValue, tagList, type, value])
  const tagItemById = useMemo(() => new Map(items.map((tag) => [tag.id, tag])), [items])
  const tagItems = useMemo(
    () =>
      createComboboxItems(items, {
        getValue: (tag) => tag.id,
        getLabel: (tag) => tag.name,
      }),
    [items],
  )

  const applyTagBindings = useCallback(() => {
    const draftTagIdSet = new Set(draftTagIds)
    const tagSelectionChanged =
      selectedTagIds.length !== draftTagIds.length ||
      selectedTagIds.some((tagId) => !draftTagIdSet.has(tagId))

    if (!tagSelectionChanged) return

    const toastId = `tag-bindings-${type}-${targetId}`

    applyTagBindingsMutation.mutate(
      {
        currentTagIds: selectedTagIds,
        nextTagIds: draftTagIds,
        targetId,
        type,
      },
      {
        onSuccess: () => {
          toast.success(
            t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }),
            {
              id: toastId,
            },
          )
        },
        onError: () => {
          toast.error(
            t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
            {
              id: toastId,
            },
          )
        },
        onSettled: () => {
          onTagsChange?.()
        },
      },
    )
  }, [applyTagBindingsMutation, draftTagIds, onTagsChange, selectedTagIds, t, targetId, type])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setDraftTagIds(selectedTagIds)
      } else {
        applyTagBindings()
      }

      setOpen(nextOpen)
    },
    [applyTagBindings, selectedTagIds],
  )

  const createNewTag = useCallback(
    (name: string) => {
      if (!canManageTags || !name || isCreatingTag) return

      createTag(
        {
          body: {
            name,
            type,
          },
        },
        {
          onSuccess: () => {
            toast.success(t(($) => $['tag.created'], { ns: 'common' }))
            setInputValue('')
          },
          onError: () => {
            toast.error(t(($) => $['tag.failed'], { ns: 'common' }))
          },
        },
      )
    },
    [canManageTags, createTag, isCreatingTag, t, type],
  )

  const handleValueChange = useCallback(
    (nextTagIds: string[]) => {
      const createOptionId = nextTagIds.find((tagId) => {
        const tag = tagItemById.get(tagId)
        return tag ? isCreateTagOption(tag) : false
      })
      const createOption = createOptionId ? tagItemById.get(createOptionId) : undefined
      if (createOption && isCreateTagOption(createOption)) {
        createNewTag(createOption.name)
        return
      }

      setDraftTagIds(nextTagIds)
    },
    [createNewTag, tagItemById],
  )

  return (
    <Combobox<TagComboboxItem['id'], true, TagComboboxItem>
      {...rootProps}
      open={open}
      onOpenChange={handleOpenChange}
      items={tagItems}
      multiple
      value={draftTagIds}
      onValueChange={handleValueChange}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      filter={TAG_COMBOBOX_FILTER}
    >
      <ComboboxTrigger
        disabled={!canManageTags && !canBindOrUnbindTags}
        aria-label={accessibleTriggerLabel}
        className={cn(
          'group/tag-area relative h-auto w-full cursor-pointer rounded-lg border-0 bg-transparent p-1 hover:bg-state-base-hover focus-visible:bg-transparent data-disabled:bg-transparent data-disabled:opacity-50 data-disabled:hover:bg-transparent data-popup-open:bg-state-base-hover data-popup-open:hover:bg-state-base-hover',
          className,
        )}
        icon={false}
        onClick={onClick}
      >
        <TagTriggerContent tags={tagNames} emptyLabel={emptyTriggerLabel} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 h-full w-20 bg-tag-selector-mask-bg group-hover/tag-area:hidden group-focus-visible/tag-area:hidden group-data-popup-open/tag-area:hidden"
        />
      </ComboboxTrigger>
      <ComboboxPortal>
        <ComboboxPositioner placement="bottom-start" sideOffset={4}>
          <ComboboxPopup
            aria-label={accessibleTriggerLabel}
            className="w-(--anchor-width) min-w-60 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
          >
            <TagSearchContent
              type={type}
              inputValue={inputValue}
              onInputValueChange={setInputValue}
              canBindOrUnbindTags={canBindOrUnbindTags}
              onOpenTagManagement={onOpenTagManagement}
              onClose={() => handleOpenChange(false)}
            />
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  )
}
