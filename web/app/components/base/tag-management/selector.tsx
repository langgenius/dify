import type { FC } from 'react'
import type { Tag } from '@/app/components/base/tag-management/constant'
import { useCallback, useMemo } from 'react'
import CustomPopover from '@/app/components/base/popover'
import { fetchTagList } from '@/service/tag'
import { cn } from '@/utils/classnames'
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
  minWidth?: string
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
  const tagList = useTagStore(s => s.tagList)
  const setTagList = useTagStore(s => s.setTagList)

  const getTagList = useCallback(async () => {
    const res = await fetchTagList(type)
    setTagList(res)
  }, [setTagList, type])

  const tags = useMemo(() => {
    if (selectedTags?.length)
      return selectedTags.filter(selectedTag => tagList.find(tag => tag.id === selectedTag.id)).map(tag => tag.name)
    return []
  }, [selectedTags, tagList])

  return (
    <>
      {isPopover && (
        <CustomPopover
          htmlContent={(
            <Panel
              type={type}
              targetID={targetID}
              value={value}
              selectedTags={selectedTags}
              onCacheUpdate={onCacheUpdate}
              onChange={onChange}
              onCreate={getTagList}
            />
          )}
          position={position}
          trigger="click"
          btnElement={<Trigger tags={tags} />}
          btnClassName={open =>
            cn(
              open ? '!bg-state-base-hover !text-text-secondary' : '!bg-transparent',
              '!w-full !border-0 !p-0 !text-text-tertiary hover:!bg-state-base-hover hover:!text-text-secondary',
            )}
          popupClassName={cn('!w-full !ring-0', minWidth && '!min-w-80')}
          className="!z-20 h-fit !w-full"
        />
      )}
    </>

  )
}

export default TagSelector
