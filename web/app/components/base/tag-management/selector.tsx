import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useUnmount } from 'ahooks'
import cn from 'classnames'
import { useStore as useTagStore } from './store'
import type { HtmlContentProps } from '@/app/components/base/popover'
import CustomPopover from '@/app/components/base/popover'
import Divider from '@/app/components/base/divider'
import SearchInput from '@/app/components/base/search-input'
import { Tag01, Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
import type { Tag } from '@/app/components/base/tag-management/constant'
import Checkbox from '@/app/components/base/checkbox'
import { bindTag, createTag, fetchTagList, unBindTag } from '@/service/tag'
import { ToastContext } from '@/app/components/base/toast'

type TagSelectorProps = {
  targetID: string
  isPopover?: boolean
  position?: 'bl' | 'br'
  type: 'knowledge' | 'app'
  value: string[]
  selectedTags: Tag[]
  onChange?: () => void
}

type PanelProps = {
  onCreate: () => void
} & HtmlContentProps & TagSelectorProps

const Panel = (props: PanelProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { targetID, type, value, selectedTags, onChange, onCreate } = props
  const { tagList, setTagList, setShowTagManagementModal } = useTagStore()
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

  const [creating, setCreating] = useState<Boolean>(false)
  const createNewTag = async () => {
    if (!keywords)
      return
    if (creating)
      return
    try {
      setCreating(true)
      const newTag = await createTag(keywords, type)
      notify({ type: 'success', message: t('dataset.tag.created') })
      setTagList([
        ...tagList,
        newTag,
      ])
      setCreating(false)
      onCreate()
    }
    catch (e: any) {
      notify({ type: 'error', message: t('dataset.tag.failed') })
      setCreating(false)
    }
  }
  const bind = async (tagIDs: string[]) => {
    try {
      await bindTag(tagIDs, targetID, 'knowledge')
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    }
    catch (e: any) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
  }
  const unbind = async (tagID: string) => {
    try {
      await unBindTag(tagID, targetID, 'knowledge')
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    }
    catch (e: any) {
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

  const onMouseLeave = async () => {
    props.onClose?.()
  }
  return (
    <div className='relative w-full bg-white rounded-lg border-[0.5px] border-gray-200' onMouseLeave={onMouseLeave}>
      <div className='p-2 border-b-[0.5px] border-black/5'>
        <SearchInput placeholder={t('dataset.tag.selectorPlaceholder') || ''} white value={keywords} onChange={handleKeywordsChange} />
      </div>
      {keywords && notExisted && (
        <div className='p-1'>
          <div className='flex items-center gap-2 pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-100' onClick={createNewTag}>
            <Plus className='h-4 w-4 text-gray-500' />
            <div className='grow text-sm text-gray-700 leading-5 truncate'>
              {`${t('dataset.tag.create')} `}
              <span className='font-medium'>{`"${keywords}"`}</span>
            </div>
          </div>
        </div>
      )}
      {keywords && notExisted && filteredTagList.length > 0 && (
        <Divider className='!h-[1px] !my-0' />
      )}
      {(filteredTagList.length > 0 || filteredSelectedTagList.length > 0) && (
        <div className='p-1 max-h-[172px] overflow-y-auto'>
          {filteredSelectedTagList.map(tag => (
            <div
              key={tag.id}
              className='flex items-center gap-2 pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-100'
              onClick={() => selectTag(tag)}
            >
              <Checkbox
                className='shrink-0 mr-2'
                checked={selectedTagIDs.includes(tag.id)}
                onCheck={() => {}}
              />
              <div title={tag.name} className='grow text-sm text-gray-700 leading-5 truncate'>{tag.name}</div>
            </div>
          ))}
          {filteredTagList.map(tag => (
            <div
              key={tag.id}
              className='flex items-center gap-2 pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-100'
              onClick={() => selectTag(tag)}
            >
              <Checkbox
                className='shrink-0 mr-2'
                checked={selectedTagIDs.includes(tag.id)}
                onCheck={() => {}}
              />
              <div title={tag.name} className='grow text-sm text-gray-700 leading-5 truncate'>{tag.name}</div>
            </div>
          ))}
        </div>
      )}
      {!keywords && !filteredTagList.length && !filteredSelectedTagList.length && (
        <div className='p-1'>
          <div className='p-3 flex flex-col items-center gap-1'>
            <Tag03 className='h-6 w-6 text-gray-300' />
            <div className='text-gray-500 text-xs leading-[14px]'>{t('dataset.tag.noTag')}</div>
          </div>
        </div>
      )}
      <Divider className='!h-[1px] !my-0' />
      <div className='p-1'>
        <div className='flex items-center gap-2 pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-100' onClick={() => setShowTagManagementModal(true)}>
          <Tag03 className='h-4 w-4 text-gray-500' />
          <div className='grow text-sm text-gray-700 leading-5 truncate'>
            {t('dataset.tag.manageTags')}
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
  onChange,
}) => {
  const { t } = useTranslation()

  const { setTagList } = useTagStore()

  const getTagList = async () => {
    const res = await fetchTagList(type)
    setTagList(res)
  }

  const triggerContent = useMemo(() => {
    if (selectedTags?.length)
      return selectedTags.map(tag => tag.name).join(', ')
    return ''
  }, [selectedTags])

  const Trigger = () => {
    return (
      <div className={cn(
        'group/tip relative w-full flex items-center gap-1 px-2 py-[7px] rounded-md cursor-pointer hover:bg-gray-100',
      )}>
        <Tag01 className='shrink-0 w-3 h-3' />
        <div className='grow text-xs text-start leading-[18px] font-normal truncate'>
          {!triggerContent ? t('dataset.tag.addTag') : triggerContent}
        </div>
        <span className='hidden absolute top-[-21px] left-[50%] translate-x-[-50%] px-2 py-[3px] border-[0.5px] border-black/5 rounded-md bg-gray-25 text-gray-700 text-xs font-medium leading-[18px] group-hover/tip:block'>{t('dataset.tag.editTag')}</span>
      </div>
    )
  }
  return (
    <>
      {isPopover && (
        <CustomPopover
          htmlContent={
            <Panel
              targetID={targetID}
              type={type}
              value={value}
              selectedTags={selectedTags}
              onChange={onChange}
              onCreate={getTagList}
            />
          }
          position={position}
          trigger="click"
          btnElement={<Trigger />}
          btnClassName={open =>
            cn(
              open ? '!bg-gray-100 !text-gray-700' : '!bg-transparent',
              '!w-full !p-0 !border-0 !text-gray-500 hover:!bg-gray-100 hover:!text-gray-700',
            )
          }
          popupClassName='!w-full !ring-0'
          className={'!w-full h-fit !z-20'}
        />
      )}
    </>

  )
}

export default TagSelector
