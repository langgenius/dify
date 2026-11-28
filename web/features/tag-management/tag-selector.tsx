import type { TagResponse as Tag, TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { ComboboxProps, ComboboxTriggerProps } from '@langgenius/dify-ui/combobox'
import type { TagComboboxItem } from './tag-option'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/console'
import { refreshAgentTagCatalogs } from '@/service/console/policies/shared'
import { getErrorMessage } from '@/utils/error-message'
import { hasPermission } from '@/utils/permission'
import { getTagManagePermissionKey } from './permissions'
import { useApplyTagBindingsMutation } from './tag-bindings'
import { isTagNameTooLong, MAX_TAG_NAME_LENGTH } from './tag-name-length'
import { getTagNameValidationMessage } from './tag-name-validation'
import { isCreateTagOption } from './tag-option'
import { TagSearchContent } from './tag-search-content'
import { TagTriggerContent } from './tag-trigger-content'

const EMPTY_TAGS: Tag[] = []
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
    requiresTargetEditPermission?: boolean
    showProvidedTagNames?: boolean
    onOpenTagManagement?: () => void
    onTagsChange?: () => void
    onApplyTags?: (tagIds: string[]) => void
  }

type ClosingTagPopup = {
  items: TagComboboxItem[]
  inputValue: string
  isTagCatalogEmpty: boolean
}

type AgentTagCreation = {
  result: Promise<string | undefined>
  pending: boolean
}

export const TagSelector = ({
  targetId,
  contextLabel,
  type,
  value,
  canBindOrUnbindTags,
  requiresTargetEditPermission = false,
  showProvidedTagNames = false,
  className,
  onClick,
  onOpenTagManagement = () => {},
  onTagsChange,
  onApplyTags,
  ...rootProps
}: TagSelectorProps) => {
  const { t } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [closingPopup, setClosingPopup] = useState<ClosingTagPopup | null>(null)
  const [draftTagIds, setDraftTagIds] = useState(() => value.map((tag) => tag.id))
  const [createdAgentTags, setCreatedAgentTags] = useState<Tag[]>(EMPTY_TAGS)
  const agentTagCreationRef = useRef<AgentTagCreation | null>(null)
  const [inputValue, setInputValue] = useState('')
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageTags = hasPermission(workspacePermissionKeys, getTagManagePermissionKey(type))
  const nameTooLong = canManageTags && isTagNameTooLong(inputValue)
  const canChangeBindings = requiresTargetEditPermission
    ? !!canBindOrUnbindTags
    : !!canBindOrUnbindTags || canManageTags

  const { isPending: isApplyingBindings, mutateAsync: saveBindings } = useApplyTagBindingsMutation()
  const { isPending: isCreatingTag, mutateAsync: createTag } = useMutation(
    consoleQuery.tags.post.mutationOptions({
      meta: {
        errorToast: false,
        deferAgentTagCatalogRefresh: type === 'agent' && !onApplyTags,
      },
    }),
  )
  const { data: tagList = EMPTY_TAGS, isSuccess: hasLoadedTags } = useQuery({
    ...consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type,
        },
      },
    }),
    // Agent cards already receive their tag names in the roster response.
    subscribed: open || type !== 'agent',
  })

  const selectedTagIds = useMemo(() => value.map((tag) => tag.id), [value])
  const tagNames = useMemo(() => {
    if (type === 'agent') return value.map((tag) => tag.name)
    if (!value.length) return []

    const tagNameById = new Map(tagList.map((tag) => [tag.id, tag.name]))
    return value.flatMap((tag) => {
      const tagName = tagNameById.get(tag.id) ?? (showProvidedTagNames ? tag.name : undefined)
      return tagName ? [tagName] : []
    })
  }, [showProvidedTagNames, tagList, type, value])
  const emptyTriggerLabel = canBindOrUnbindTags
    ? t(($) => $['tag.addTag'], { ns: 'common' })
    : t(($) => $['tag.noTag'], { ns: 'common' })
  const triggerLabel = tagNames.length ? tagNames.join(', ') : emptyTriggerLabel
  const accessibleTriggerLabel = contextLabel ? `${triggerLabel}: ${contextLabel}` : triggerLabel

  const items = useMemo<TagComboboxItem[]>(() => {
    if (!open) return closingPopup?.items ?? EMPTY_TAGS

    const tagIds = new Set<string>()
    const nextItems: TagComboboxItem[] = []
    const normalizedInputValue = normalizeTagName(inputValue)

    for (const tag of tagList) {
      if (tag.type !== type) continue

      tagIds.add(tag.id)
      nextItems.push(tag)
    }

    for (const tag of [...value, ...createdAgentTags]) {
      if (tag.type === type && !tagIds.has(tag.id)) {
        tagIds.add(tag.id)
        nextItems.push(tag)
      }
    }

    if (
      canManageTags &&
      !nameTooLong &&
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
  }, [
    canManageTags,
    closingPopup,
    createdAgentTags,
    inputValue,
    nameTooLong,
    open,
    tagList,
    type,
    value,
  ])
  const isTagCatalogEmpty = closingPopup?.isTagCatalogEmpty ?? (hasLoadedTags && items.length === 0)
  const tagItemById = useMemo(() => new Map(items.map((tag) => [tag.id, tag])), [items])
  const tagItems = useMemo(
    () =>
      createComboboxItems(items, {
        getValue: (tag) => tag.id,
        getLabel: (tag) => tag.name,
      }),
    [items],
  )

  const applyTagBindings = useCallback(async () => {
    const creation = agentTagCreationRef.current
    const createdId = creation && (await creation.result)
    // The POST can resolve before React commits the updated draft. A committed draft may
    // already have deselected the new tag, so only append IDs it has not seen yet.
    const nextTagIds =
      createdId && !createdAgentTags.some((tag) => tag.id === createdId)
        ? [...draftTagIds, createdId]
        : draftTagIds
    const draftTagIdSet = new Set(nextTagIds)
    const tagSelectionChanged =
      selectedTagIds.length !== nextTagIds.length ||
      selectedTagIds.some((tagId) => !draftTagIdSet.has(tagId))

    if (!tagSelectionChanged) {
      if (!onApplyTags && createdAgentTags.length)
        await refreshAgentTagCatalogs(consoleQuery, queryClient)
      return
    }

    if (onApplyTags) {
      onApplyTags(nextTagIds)
      return
    }

    const toastId = `tag-bindings-${type}-${targetId}`

    // Refreshing a filtered list can unmount the selector before the save completes.
    try {
      await saveBindings(
        { currentTagIds: selectedTagIds, nextTagIds, targetId, type },
        { onSettled: onTagsChange },
      )
      toast.success(
        t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }),
        { id: toastId },
      )
    } catch (error) {
      toast.error(
        getErrorMessage(error) ?? t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        { id: toastId },
      )
    }
  }, [
    createdAgentTags,
    draftTagIds,
    onApplyTags,
    onTagsChange,
    queryClient,
    saveBindings,
    selectedTagIds,
    t,
    targetId,
    type,
  ])

  const closeAndApply = () => {
    if (!open) return
    // Applying bindings can refresh the catalog while the popup is still fading out.
    setClosingPopup({ items, inputValue, isTagCatalogEmpty })
    void applyTagBindings()
    setOpen(false)
  }
  const isSavingAgentTags = type === 'agent' && !open && (isCreatingTag || isApplyingBindings)

  const createNewTag = useCallback(
    (name: string) => {
      if (!canManageTags || !name || isCreatingTag || agentTagCreationRef.current?.pending) return

      const creation = createTag({ body: { name, type } }).then(
        (tag) => {
          if (type === 'agent') {
            setCreatedAgentTags((tags) => [...tags, tag])
            setDraftTagIds((ids) => [...ids, tag.id])
          }
          toast.success(t(($) => $['tag.created'], { ns: 'common' }))
          setInputValue('')
          return tag.id
        },
        (error: unknown) => {
          toast.error(
            getTagNameValidationMessage(error, t, 'create') ??
              getErrorMessage(error) ??
              t(($) => $['tag.failed']),
          )
          return undefined
        },
      )
      if (type === 'agent') {
        const operation = { result: creation, pending: true }
        agentTagCreationRef.current = operation
        void creation.then(() => {
          operation.pending = false
        })
      }
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
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen) return closeAndApply()
        if (isSavingAgentTags) return details.cancel()
        agentTagCreationRef.current = null
        setDraftTagIds(selectedTagIds)
        setCreatedAgentTags(EMPTY_TAGS)
        setClosingPopup(null)
        setOpen(true)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setClosingPopup(null)
      }}
      items={tagItems}
      multiple
      value={draftTagIds}
      onValueChange={handleValueChange}
      inputValue={closingPopup?.inputValue ?? inputValue}
      onInputValueChange={(nextValue) => {
        if (canManageTags && !nameTooLong && isTagNameTooLong(nextValue))
          toast.error(t(($) => $['tag.nameTooLong'], { max: MAX_TAG_NAME_LENGTH }))
        setInputValue(nextValue)
      }}
      filter={TAG_COMBOBOX_FILTER}
    >
      <ComboboxTrigger
        disabled={!canChangeBindings}
        aria-disabled={isSavingAgentTags || undefined}
        aria-label={accessibleTriggerLabel}
        className={cn(
          'group/tag-area relative flex w-full min-w-0 cursor-pointer items-center gap-0.5 rounded-lg p-1 text-start transition-colors hover:bg-state-base-hover data-popup-open:bg-state-base-hover motion-reduce:transition-none',
          (!canChangeBindings || isSavingAgentTags) &&
            'cursor-not-allowed opacity-50 hover:bg-transparent',
          className,
        )}
        onClick={onClick}
      >
        <TagTriggerContent tags={tagNames} emptyLabel={emptyTriggerLabel} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-e-0 top-0 h-full w-20 bg-tag-selector-mask-bg group-hover/tag-area:hidden group-focus-visible/tag-area:hidden group-data-popup-open/tag-area:hidden"
        />
      </ComboboxTrigger>
      <ComboboxPortal>
        <ComboboxPositioner>
          <ComboboxPopup
            onClick={(event) => event.stopPropagation()}
            aria-label={accessibleTriggerLabel}
            className="w-(--anchor-width) min-w-60 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
          >
            <TagSearchContent
              type={type}
              nameTooLong={nameTooLong}
              isTagCatalogEmpty={isTagCatalogEmpty}
              canBindOrUnbindTags={canBindOrUnbindTags}
              requiresTargetEditPermission={requiresTargetEditPermission}
              onOpenTagManagement={onOpenTagManagement}
              onClose={closeAndApply}
            />
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  )
}
