import type { FC } from 'react'
import type { Tag } from '@/app/components/base/tag-management/constant'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { fetchTagList } from '@/service/tag'
import Panel from './panel'
import { useStore as useTagStore } from './store'
import Trigger from './trigger'

export type TagSelectorProps = {
  targetID: string
  isPopover?: boolean
  position?: 'bl' | 'br'
  type: 'knowledge' | 'app'
  value: string[]
  selectedTags: Tag[]
  onCacheUpdate: (tags: Tag[]) => void
  onChange?: () => void
  minWidth?: number | string
}

const TagSelector: FC<TagSelectorProps> = ({
  targetID,
  isPopover = true,
  position,
  type,
  value,
  selectedTags,
  onCacheUpdate,
  onChange,
  minWidth,
}) => {
  const { t } = useTranslation()
  const tagList = useTagStore(s => s.tagList)
  const setTagList = useTagStore(s => s.setTagList)
  const [open, setOpen] = useState(false)

  const getTagList = useCallback(async () => {
    const res = await fetchTagList(type)
    setTagList(res)
  }, [setTagList, type])

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

  if (!isPopover)
    return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          onCacheUpdate={onCacheUpdate}
          onChange={onChange}
          onCreate={getTagList}
        />
      </PopoverContent>
    </Popover>
  )
}

export default TagSelector
