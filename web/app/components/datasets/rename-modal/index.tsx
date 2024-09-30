'use client'

import type { MouseEventHandler } from 'react'
import { useState } from 'react'
import { RiCloseLine } from '@remixicon/react'
import { BookOpenIcon } from '@heroicons/react/24/outline'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import type { DataSet } from '@/models/datasets'
import { updateDatasetSetting } from '@/service/datasets'

type RenameDatasetModalProps = {
  show: boolean
  dataset: DataSet
  onSuccess?: () => void
  onClose: () => void
}

const RenameDatasetModal = ({ show, dataset, onSuccess, onClose }: RenameDatasetModalProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState<string>(dataset.name)
  const [description, setDescription] = useState<string>(dataset.description)
  const [externalKnowledgeId, setExternalKnowledgeId] = useState<string>(dataset.external_knowledge_info.external_knowledge_id)
  const [externalKnowledgeApiId, setExternalKnowledgeApiId] = useState<string>(dataset.external_knowledge_info.external_knowledge_api_id)

  const onConfirm: MouseEventHandler = async () => {
    if (!name.trim()) {
      notify({ type: 'error', message: t('datasetSettings.form.nameError') })
      return
    }
    try {
      setLoading(true)
      const body: Partial<DataSet> & { external_knowledge_id?: string; external_knowledge_api_id?: string } = {
        name,
        description,
      }
      if (externalKnowledgeId && externalKnowledgeApiId) {
        body.external_knowledge_id = externalKnowledgeId
        body.external_knowledge_api_id = externalKnowledgeApiId
      }
      await updateDatasetSetting({
        datasetId: dataset.id,
        body,
      })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      if (onSuccess)
        onSuccess()
      onClose()
    }
    catch (e) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      className='px-8 py-6 max-w-[520px] w-[520px] rounded-xl'
      isShow={show}
      onClose={() => { }}
    >
      <div className='relative pb-2 text-xl font-medium leading-[30px] text-gray-900'>{t('datasetSettings.title')}</div>
      <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={onClose}>
        <RiCloseLine className='w-4 h-4 text-gray-500' />
      </div>
      <div>
        <div className={cn('flex justify-between py-4 flex-wrap items-center')}>
          <div className='shrink-0 py-2 text-sm font-medium leading-[20px] text-gray-900'>
            {t('datasetSettings.form.name')}
          </div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className='block px-3 w-full h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
            placeholder={t('datasetSettings.form.namePlaceholder') || ''}
          />
        </div>
        <div className={cn('flex justify-between py-4 flex-wrap items-center')}>
          <div className='shrink-0 py-2 text-sm font-medium leading-[20px] text-gray-900'>
            {t('datasetSettings.form.desc')}
          </div>
          <div className='w-full'>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className='block px-3 py-2 w-full h-[88px] rounded-lg bg-gray-100 text-sm outline-none appearance-none resize-none'
              placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            />
            <a className='mt-2 flex items-center h-[18px] px-3 text-xs text-gray-500 hover:text-primary-600' href="https://docs.dify.ai/features/datasets#how-to-write-a-good-dataset-description" target='_blank' rel='noopener noreferrer'>
              <BookOpenIcon className='w-3 h-[18px] mr-1' />
              {t('datasetSettings.form.descWrite')}
            </a>
          </div>
        </div>
      </div>
      <div className='pt-6 flex justify-end'>
        <Button className='mr-2' onClick={onClose}>{t('common.operation.cancel')}</Button>
        <Button disabled={loading} variant="primary" onClick={onConfirm}>{t('common.operation.save')}</Button>
      </div>
    </Modal>
  )
}

export default RenameDatasetModal
