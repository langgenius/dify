import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useUnmount } from 'ahooks'
import { RiAddLine } from '@remixicon/react'
import { useStore as useTagStore } from './store'
import cn from '@/utils/classnames'
import type { HtmlContentProps } from '@/app/components/base/popover'
import CustomPopover from '@/app/components/base/popover'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { Tag01, Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import type { Tag } from '@/app/components/base/tag-management/constant'
import Checkbox from '@/app/components/base/checkbox'
import { bindTag, createTag, fetchTagList, unBindTag } from '@/service/tag'
import { ToastContext } from '@/app/components/base/toast'
import { noop } from 'lodash-es'

type TagSelectorProps = {
  targetID: string
  isPopover?: boolean
  position?: 'bl' | 'br'
  type: 'knowledge' | 'app'
  value: string[]
  selectedTags: Tag[]
  onCacheUpdate: (tags: Tag[]) => void
  onChange?: () => void
}

type PanelProps = {
  onCreate: () => void
} & HtmlContentProps & TagSelectorProps

const Panel = (props: PanelProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { targetID, type, value, selectedTags, onCacheUpdate, onChange, onCreate } = props
  const tagList = useTagStore(s => s.tagList)
  const setTagList = useTagStore(s => s.setTagList)
  const setShowTagManagementModal = useTagStore(s => s.setShowTagManagementModal)
  const [selectedTagIDs, setSelectedTagIDs] = useState<string[]>(value)
  const [keywords, setKeywords] = useState('')
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
  }

  const notExisted = useMemo(() => {
    return tagList.every(tag => tag.type === type && tag.name !== keywords)
  }, [type, tagList, keywords])
  const filteredSelectedTagList = useMemo(() => {
    return selectedTags.filter(tag => tag.name.includes(keywords))
  }, [keywords, selectedTags])
  const filteredTagList = useMemo(() => {
    return tagList.filter(tag => tag.type === type && !value.includes(tag.id) && tag.name.includes(keywords))
  }, [type, tagList, value, keywords])

  const [creating, setCreating] = useState<boolean>(false)
  const createNewTag = async () => {
    if (!keywords)
      return
    if (creating)
      return
    try {
      setCreating(true)
      const newTag = await createTag(keywords, type)
      notify({ type: 'success', message: t('common.tag.created') })
      setTagList([
        ...tagList,
        newTag,
      ])
      setKeywords('')
      setCreating(false)
      onCreate()
    }
    catch {
      notify({ type: 'error', message: t('common.tag.failed') })
      setCreating(false)
    }
  }
  const bind = async (tagIDs: string[]) => {
    try {
      await bindTag(tagIDs, targetID, type)
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    }
    catch {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
  }
  const unbind = async (tagID: string) => {
    try {
      await unBindTag(tagID, targetID, type)
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    }
    catch {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
  }
  const selectTag = (tag: Tag) => {
    if (selectedTagIDs.includes(tag.id))
      setSelectedTagIDs(selectedTagIDs.filter(v => v !== tag.id))
    else
      setSelectedTagIDs([...selectedTagIDs, tag.id])
  }

  const valueNotChanged = useMemo(() => {
    return value.length === selectedTagIDs.length && value.every(v => selectedTagIDs.includes(v)) && selectedTagIDs.every(v => value.includes(v))
  }, [value, selectedTagIDs])
  const handleValueChange = () => {
    const addTagIDs = selectedTagIDs.filter(v => !value.includes(v))
    const removeTagIDs = value.filter(v => !selectedTagIDs.includes(v))
    const selectedTags = tagList.filter(tag => selectedTagIDs.includes(tag.id))
    onCacheUpdate(selectedTags)
    Promise.all([
      ...(addTagIDs.length ? [bind(addTagIDs)] : []),
      ...[removeTagIDs.length ? removeTagIDs.map(tagID => unbind(tagID)) : []],
    ]).finally(() => {
      if (onChange)
        onChange()
    })
  }
  useUnmount(() => {
    if (valueNotChanged)
      return
    handleValueChange()
  })

  return (
    <div className='relative w-full rounded-lg border-[0.5px] border-components-panel-border bg-components-input-bg-hover'>
      <div className='border-b-[0.5px] border-divider-regular p-2'>
        <Input
          showLeftIcon
          showClearIcon
          value={keywords}
          placeholder={t('common.tag.selectorPlaceholder') || ''}
          onChange={e => handleKeywordsChange(e.target.value)}
          onClear={() => handleKeywordsChange('')}
        />
      </div>
      {keywords && notExisted && (
        <div className='p-1'>
          <div className='flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pl-3 pr-2 hover:bg-state-base-hover' onClick={createNewTag}>
            <RiAddLine className='h-4 w-4 text-text-tertiary' />
            <div className='grow truncate text-sm leading-5 text-text-secondary'>
              {`${t('common.tag.create')} `}
              <span className='font-medium'>{`"${keywords}"`}</span>
            </div>
          </div>
        </div>
      )}
      {keywords && notExisted && filteredTagList.length > 0 && (
        <Divider className='!my-0 !h-[1px]' />
      )}
      {(filteredTagList.length > 0 || filteredSelectedTagList.length > 0) && (
        <div className='max-h-[172px] overflow-y-auto p-1'>
          {filteredSelectedTagList.map(tag => (
            <div
              key={tag.id}
              className='flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pl-3 pr-2 hover:bg-state-base-hover'
              onClick={() => selectTag(tag)}
            >
              <Checkbox
                className='shrink-0'
                checked={selectedTagIDs.includes(tag.id)}
                onCheck={noop}
              />
              <div title={tag.name} className='grow truncate text-sm leading-5 text-text-secondary'>{tag.name}</div>
            </div>
          ))}
          {filteredTagList.map(tag => (
            <div
              key={tag.id}
              className='flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pl-3 pr-2 hover:bg-state-base-hover'
              onClick={() => selectTag(tag)}
            >
              <Checkbox
                className='shrink-0'
                checked={selectedTagIDs.includes(tag.id)}
                onCheck={noop}
              />
              <div title={tag.name} className='grow truncate text-sm leading-5 text-text-secondary'>{tag.name}</div>
            </div>
          ))}
        </div>
      )}
      {!keywords && !filteredTagList.length && !filteredSelectedTagList.length && (
        <div className='p-1'>
          <div className='flex flex-col items-center gap-1 p-3'>
            <Tag03 className='h-6 w-6 text-text-quaternary' />
            <div className='text-xs leading-[14px] text-text-tertiary'>{t('common.tag.noTag')}</div>
          </div>
        </div>
      )}
      <Divider className='!my-0 !h-[1px]' />
      <div className='p-1'>
        <div className='flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pl-3 pr-2 hover:bg-state-base-hover' onClick={() => setShowTagManagementModal(true)}>
          <Tag03 className='h-4 w-4 text-text-tertiary' />
          <div className='grow truncate text-sm leading-5 text-text-secondary'>
            {t('common.tag.manageTags')}
          </div>
        </div>
      </div>
    </div>
  )
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
}) => {
  const { t } = useTranslation()

  const tagList = useTagStore(s => s.tagList)
  const setTagList = useTagStore(s => s.setTagList)

  const getTagList = async () => {
    const res = await fetchTagList(type)
    setTagList(res)
  }

  const triggerContent = useMemo(() => {
    if (selectedTags?.length)
      return selectedTags.filter(selectedTag => tagList.find(tag => tag.id === selectedTag.id)).map(tag => tag.name).join(', ')
    return ''
  }, [selectedTags, tagList])

  const Trigger = () => {
    return (
      <div className={cn(
        'group/tip relative flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-[7px] hover:bg-state-base-hover',
      )}>
        <Tag01 className='h-3 w-3 shrink-0 text-components-input-text-placeholder' />
        <div className='system-sm-regular grow truncate  text-start text-components-input-text-placeholder'>
          {!triggerContent ? t('common.tag.addTag') : triggerContent}
        </div>
      </div>
    )
  }
  return (
    <>
      {isPopover && (
        <CustomPopover
          htmlContent={
            <Panel
              type={type}
              targetID={targetID}
              value={value}
              selectedTags={selectedTags}
              onCacheUpdate={onCacheUpdate}
              onChange={onChange}
              onCreate={getTagList}
            />
          }
          position={position}
          trigger="click"
          btnElement={<Trigger />}
          btnClassName={open =>
            cn(
              open ? '!bg-state-base-hover !text-text-secondary' : '!bg-transparent',
              '!w-full !border-0 !p-0 !text-text-tertiary hover:!bg-state-base-hover hover:!text-text-secondary',
            )
          }
          popupClassName='!w-full !ring-0'
          className={'!z-20 h-fit !w-full'}
        />
      )}
    </>

  )
}

export default TagSelector
