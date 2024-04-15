import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
// import { useDebounceFn } from 'ahooks'
import cn from 'classnames'
import { useStore as useTagStore } from './store'
import type { HtmlContentProps } from '@/app/components/base/popover'
import CustomPopover from '@/app/components/base/popover'
import Divider from '@/app/components/base/divider'
import SearchInput from '@/app/components/base/search-input'
import { Tag03 } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
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
  onChange?: () => void
}

type PanelProps = {
  onCreate: () => void
} & HtmlContentProps & TagSelectorProps

const Panel = (props: PanelProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { targetID, type, value, onChange, onCreate } = props
  const { tagList, setTagList, setShowTagManagementModal } = useTagStore()
  const [keywords, setKeywords] = useState('')
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
  }

  const filteredTagList = useMemo(() => {
    return tagList.filter(tag => tag.type === type && tag.name.includes(keywords))
  }, [type, tagList, keywords])
  const notExisted = useMemo(() => {
    return tagList.every(tag => tag.type === type && tag.name !== keywords)
  }, [type, tagList, keywords])

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
  const bind = async (tag: Tag) => {
    try {
      await bindTag([tag.id], targetID, 'knowledge')
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      if (onChange)
        onChange()
    }
    catch (e: any) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
  }
  const unbind = async (tag: Tag) => {
    try {
      await unBindTag([tag.id], targetID, 'knowledge')
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      if (onChange)
        onChange()
    }
    catch (e: any) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
  }
  const selectTag = (tag: Tag) => {
    if (value.includes(tag.id))
      unbind(tag)
    else
      bind(tag)
  }

  const onMouseLeave = async () => {
    props.onClose?.()
  }
  return (
    <div className='relative w-[240px] bg-white rounded-lg border-[0.5px] border-gray-200' onMouseLeave={onMouseLeave}>
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
      {filteredTagList.length > 0 && (
        <div className='p-1 max-h-[172px] overflow-y-auto'>
          {filteredTagList.map(tag => (
            <div
              key={tag.id}
              className='flex items-center gap-2 pl-3 py-[6px] pr-2 rounded-lg cursor-pointer hover:bg-gray-100'
              onClick={() => selectTag(tag)}
            >
              <Checkbox
                className='shrink-0 mr-2'
                checked={value.includes(tag.id)}
                onCheck={() => {}}
              />
              <div title={tag.name} className='grow text-sm text-gray-700 leading-5 truncate'>{tag.name}</div>
            </div>
          ))}
        </div>
      )}
      {!keywords && !filteredTagList.length && (
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
  onChange,
}) => {
  const { t } = useTranslation()

  const { setTagList } = useTagStore()

  const getTagList = async () => {
    const res = await fetchTagList(type)
    setTagList(res)
  }

  const Trigger = () => {
    return (
      <div className={cn(
        'flex items-center px-1 text-xs leading-4.5 cursor-pointer border border-dashed rounded-[5px]',
      )}>
        <Plus className='w-3 h-3' />
        <span className='ml-0.5 '>{t('dataset.tag.addTag')}</span>
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
              onChange={onChange}
              onCreate={getTagList}
            />
          }
          position={position}
          trigger="click"
          btnElement={<Trigger />}
          btnClassName={open =>
            cn(
              open ? '!bg-gray-50 !text-gray-500' : '!bg-transparent',
              '!p-0 !border-0 !text-gray-400 hover:!bg-gray-50 hover:!text-gray-500',
            )
          }
          popupClassName='!ring-0'
          className={'!w-[128px] h-fit !z-20'}
        />
      )}
    </>

  )
}

export default TagSelector
