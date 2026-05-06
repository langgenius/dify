import type { Tag } from '@/contract/console/tags'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { useApplyTagBindingsMutation } from '../hooks/use-tag-mutations'
import { TagPanel } from './tag-panel'
import { TagTrigger } from './tag-trigger'

type TagSelectorProps = {
  targetId: string
  isPopover?: boolean
  position?: 'bl' | 'br'
  type: 'knowledge' | 'app'
  selectedTagIds: string[]
  selectedTags: Tag[]
  onOpenTagManagement?: () => void
  onTagsChange?: () => void
  minWidth?: number | string
}

export const TagSelector = ({
  targetId,
  isPopover = true,
  position,
  type,
  selectedTagIds,
  selectedTags,
  onOpenTagManagement = () => {},
  onTagsChange,
  minWidth,
}: TagSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftTagIds, setDraftTagIds] = useState<string[]>(selectedTagIds)
  const applyTagBindingsMutation = useApplyTagBindingsMutation()
  const { data: tagList = [] } = useQuery(consoleQuery.tags.list.queryOptions({
    input: {
      query: {
        type,
      },
    },
  }))

  const tagNames = selectedTags.length
    ? selectedTags.filter(selectedTag => tagList.find(tag => tag.id === selectedTag.id)).map(tag => tag.name)
    : []
  const placement = position === 'bl'
    ? 'bottom-start'
    : position === 'br'
      ? 'bottom-end'
      : 'bottom'
  const resolvedMinWidth = minWidth == null
    ? undefined
    : typeof minWidth === 'number' ? `${minWidth}px` : minWidth
  const triggerLabel = tagNames.length ? tagNames.join(', ') : t('tag.addTag', { ns: 'common' })

  const applyTagBindings = useCallback(() => {
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
  }, [applyTagBindingsMutation, draftTagIds, onTagsChange, selectedTagIds, t, targetId, type])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen)
      setDraftTagIds(selectedTagIds)
    else
      applyTagBindings()

    setOpen(nextOpen)
  }, [applyTagBindings, selectedTagIds])

  if (!isPopover)
    return null

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={triggerLabel}
        className={cn(
          open ? 'bg-state-base-hover' : 'bg-transparent',
          'block w-full rounded-lg border-0 p-0 text-left focus:outline-hidden focus-visible:ring-1 focus-visible:ring-components-input-border-hover',
        )}
      >
        <TagTrigger tags={tagNames} />
      </PopoverTrigger>
      <PopoverContent
        placement={placement}
        sideOffset={4}
        popupClassName="overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]"
        popupProps={{
          style: {
            width: 'var(--anchor-width, auto)',
            minWidth: resolvedMinWidth,
          },
        }}
      >
        <TagPanel
          type={type}
          selectedTagIds={selectedTagIds}
          selectedTags={selectedTags}
          draftTagIds={draftTagIds}
          onDraftTagIdsChange={setDraftTagIds}
          tagList={tagList}
          onOpenTagManagement={onOpenTagManagement}
          onClose={() => handleOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
