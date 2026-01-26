'use client'

import { RiCloseLine } from '@remixicon/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import {
  createTag,
  fetchTagList,
} from '@/service/tag'
import { useStore as useTagStore } from './store'
import TagItemEditor from './tag-item-editor'

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

  const [pending, setPending] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const createNewTag = async () => {
    if (!name)
      return
    if (pending)
      return
    try {
      setPending(true)
      const newTag = await createTag(name, type)
      notify({ type: 'success', message: t('tag.created', { ns: 'common' }) })
      setTagList([
        newTag,
        ...tagList,
      ])
      setName('')
      setPending(false)
    }
    catch {
      notify({ type: 'error', message: t('tag.failed', { ns: 'common' }) })
      setPending(false)
    }
  }

  useEffect(() => {
    getTagList(type)
  }, [type])

  return (
    <Modal
      className="!w-[600px] !max-w-[600px] rounded-xl px-8 py-6"
      isShow={show}
      onClose={() => setShowTagManagementModal(false)}
    >
      <div className="relative pb-2 text-xl font-semibold leading-[30px] text-text-primary">{t('tag.manageTags', { ns: 'common' })}</div>
      <div className="absolute right-4 top-4 cursor-pointer p-2" onClick={() => setShowTagManagementModal(false)}>
        <RiCloseLine className="h-4 w-4 text-text-tertiary" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="w-[100px] shrink-0 appearance-none rounded-lg border border-dashed border-divider-regular bg-transparent px-2 py-1 text-sm leading-5 text-text-secondary caret-primary-600  outline-none placeholder:text-text-quaternary focus:border-solid"
          placeholder={t('tag.addNew', { ns: 'common' }) || ''}
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && createNewTag()}
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
