'use client'

import { useEffect, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useStore as useTagStore } from './store'
import TagItemEditor from './tag-item-editor'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import {
  createTag,
  fetchTagList,
} from '@/service/tag'

type TagManagementModalProps = {
  type: 'knowledge' | 'app'
  show: boolean
}

const TagManagementModal = ({ show, type }: TagManagementModalProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const tagList = useTagStore(s => s.tagList)
  const setTagList = useTagStore(s => s.setTagList)
  const setShowTagManagementModal = useTagStore(s => s.setShowTagManagementModal)

  const getTagList = async (type: 'knowledge' | 'app') => {
    const res = await fetchTagList(type)
    setTagList(res)
  }

  const [pending, setPending] = useState<Boolean>(false)
  const [name, setName] = useState<string>('')
  const createNewTag = async () => {
    if (!name)
      return
    if (pending)
      return
    try {
      setPending(true)
      const newTag = await createTag(name, type)
      notify({ type: 'success', message: t('common.tag.created') })
      setTagList([
        newTag,
        ...tagList,
      ])
      setName('')
      setPending(false)
    }
    catch (e: any) {
      notify({ type: 'error', message: t('common.tag.failed') })
      setPending(false)
    }
  }

  useEffect(() => {
    getTagList(type)
  }, [type])

  return (
    <Modal
      wrapperClassName='!z-[1020]'
      className='px-8 py-6 !max-w-[600px] !w-[600px] rounded-xl'
      isShow={show}
      onClose={() => setShowTagManagementModal(false)}
    >
      <div className='relative pb-2 text-xl font-semibold leading-[30px] text-gray-900'>{t('common.tag.manageTags')}</div>
      <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={() => setShowTagManagementModal(false)}>
        <XClose className='w-4 h-4 text-gray-500' />
      </div>
      <div className='mt-3 flex flex-wrap gap-2'>
        <input
          className='shrink-0 w-[100px] px-2 py-1 rounded-lg border border-dashed border-gray-200 text-sm leading-5 text-gray-700 outline-none appearance-none  placeholder:text-gray-300 caret-primary-600 focus:border-solid'
          placeholder={t('common.tag.addNew') || ''}
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createNewTag()}
          onBlur={createNewTag}
        />
        {tagList.map(tag => (
          <TagItemEditor
            key={tag.id}
            tag={tag}
          />
        ))}
      </div>
    </Modal>
  )
}

export default TagManagementModal
