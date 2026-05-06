import type { FC } from 'react'
import type { Tag } from '@/contract/console/tags'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { useApplyTagBindingsMutation } from './hooks'
import Panel from './panel'
import Trigger from './trigger'

export type TagSelectorProps = {
  targetID: string
  isPopover?: boolean
  position?: 'bl' | 'br'
  type: 'knowledge' | 'app'
  value: string[]
  selectedTags: Tag[]
  onOpenTagManagement?: () => void
  minWidth?: number | string
}

const TagSelector: FC<TagSelectorProps> = ({
  targetID,
  isPopover = true,
  position,
  type,
  value,
  selectedTags,
  onOpenTagManagement = () => {},
  minWidth,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selectedTagIDs, setSelectedTagIDs] = useState<string[]>(value)
  const applyTagBindingsMutation = useApplyTagBindingsMutation()
  const { data: tagList = [] } = useQuery(consoleQuery.tags.list.queryOptions({
    input: {
      query: {
        type,
      },
    },
  }))

  const tags = useMemo(() => {
    if (selectedTags?.length)
      return selectedTags.filter(selectedTag => tagList.find(tag => tag.id === selectedTag.id)).map(tag => tag.name)
    return []
  }, [selectedTags, tagList])

  const placement = useMemo(() => {
    if (position === 'bl')
      return 'bottom-start' as const
    if (position === 'br')
      return 'bottom-end' as const
    return 'bottom' as const
  }, [position])

  const resolvedMinWidth = useMemo(() => {
    if (minWidth == null)
      return undefined

    return typeof minWidth === 'number' ? `${minWidth}px` : minWidth
  }, [minWidth])

  const triggerLabel = useMemo(() => {
    if (tags.length)
      return tags.join(', ')

    return t('tag.addTag', { ns: 'common' })
  }, [tags, t])

  const tagSelectionChanged = useMemo(() => {
    if (value.length !== selectedTagIDs.length)
      return true

    const selectedTagIDSet = new Set(selectedTagIDs)
    return value.some(tagID => !selectedTagIDSet.has(tagID))
  }, [value, selectedTagIDs])

  const applyTagBindings = useCallback(() => {
    if (!tagSelectionChanged)
      return

    const toastId = `tag-bindings-${type}-${targetID}`

    applyTagBindingsMutation.mutate({
      currentTagIDs: value,
      nextTagIDs: selectedTagIDs,
      targetID,
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
    })
  }, [applyTagBindingsMutation, selectedTagIDs, t, tagSelectionChanged, targetID, type, value])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen)
      setSelectedTagIDs(value)
    else
      applyTagBindings()

    setOpen(nextOpen)
  }, [applyTagBindings, value])

  if (!isPopover)
    return null

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={triggerLabel}
        className={cn(
          open ? 'bg-state-base-hover' : 'bg-transparent',
          'block w-full rounded-lg border-0 p-0 text-left focus:outline-hidden',
        )}
      >
        <Trigger tags={tags} />
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
        <Panel
          type={type}
          targetID={targetID}
          value={value}
          selectedTags={selectedTags}
          selectedTagIDs={selectedTagIDs}
          onSelectedTagIDsChange={setSelectedTagIDs}
          tagList={tagList}
          onOpenTagManagement={onOpenTagManagement}
          onClose={() => handleOpenChange(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

export default TagSelector
