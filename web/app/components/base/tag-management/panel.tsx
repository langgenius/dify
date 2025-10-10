import React, { useMemo, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useUnmount } from 'ahooks'
import { RiAddLine, RiPriceTag3Line } from '@remixicon/react'
import { useStore as useTagStore } from './store'
import type { HtmlContentProps } from '@/app/components/base/popover'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import type { Tag } from '@/app/components/base/tag-management/constant'
import Checkbox from '@/app/components/base/checkbox'
import { bindTag, createTag, unBindTag } from '@/service/tag'
import { ToastContext } from '@/app/components/base/toast'
import { noop } from 'lodash-es'
import type { TagSelectorProps } from './selector'

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
    const operations: Promise<unknown>[] = []
    if (addTagIDs.length)
      operations.push(bind(addTagIDs))
    if (removeTagIDs.length)
      operations.push(...removeTagIDs.map(tagID => unbind(tagID)))

    Promise.all(operations).finally(() => {
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
    <div className='relative w-full rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur'>
      <div className='p-2 pb-1'>
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
          <div
            className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
            onClick={createNewTag}
          >
            <RiAddLine className='h-4 w-4 text-text-tertiary' />
            <div className='system-md-regular grow truncate px-1 text-text-secondary'>
              {`${t('common.tag.create')} `}
              <span className='system-md-medium'>{`'${keywords}'`}</span>
            </div>
          </div>
        </div>
      )}
      {keywords && notExisted && filteredTagList.length > 0 && (
        <Divider type='horizontal' className='my-0 h-px bg-divider-subtle' />
      )}
      {(filteredTagList.length > 0 || filteredSelectedTagList.length > 0) && (
        <div className='max-h-[232px] overflow-y-auto p-1'>
          {filteredSelectedTagList.map(tag => (
            <div
              key={tag.id}
              className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
              onClick={() => selectTag(tag)}
            >
              <Checkbox
                className='shrink-0'
                checked={selectedTagIDs.includes(tag.id)}
                onCheck={noop}
              />
              <div
                title={tag.name}
                className='system-md-regular grow truncate px-1 text-text-secondary'
              >
                {tag.name}
              </div>
            </div>
          ))}
          {filteredTagList.map(tag => (
            <div
              key={tag.id}
              className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
              onClick={() => selectTag(tag)}
            >
              <Checkbox
                className='shrink-0'
                checked={selectedTagIDs.includes(tag.id)}
                onCheck={noop}
              />
              <div
                title={tag.name}
                className='system-md-regular grow truncate px-1 text-text-secondary'
              >
                {tag.name}
              </div>
            </div>
          ))}
        </div>
      )}
      {!keywords && !filteredTagList.length && !filteredSelectedTagList.length && (
        <div className='p-1'>
          <div className='flex flex-col items-center gap-y-1 p-3'>
            <RiPriceTag3Line className='h-6 w-6 text-text-quaternary' />
            <div className='system-xs-regular text-text-tertiary'>{t('common.tag.noTag')}</div>
          </div>
        </div>
      )}
      <Divider type='horizontal' className='my-0 h-px bg-divider-subtle' />
      <div className='p-1'>
        <div
          className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
          onClick={() => setShowTagManagementModal(true)}
        >
          <RiPriceTag3Line className='h-4 w-4 text-text-tertiary' />
          <div className='system-md-regular grow truncate px-1 text-text-secondary'>
            {t('common.tag.manageTags')}
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(Panel)
