'use client'

import type { MouseEventHandler } from 'react'
import { useState } from 'react'
import { RiCloseLine } from '@remixicon/react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import type { DataSet } from '@/models/datasets'
import { updateDatasetSetting } from '@/service/datasets'

interface RenameDatasetModalProps {
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
      className='w-[520px] max-w-[520px] rounded-xl px-8 py-6'
      isShow={show}
      onClose={() => { }}
    >
      <div className='relative pb-2 text-xl font-medium leading-[30px] text-gray-900'>{t('datasetSettings.title')}</div>
      <div className='absolute right-4 top-4 cursor-pointer p-2' onClick={onClose}>
        <RiCloseLine className='h-4 w-4 text-gray-500' />
      </div>
      <div>
        <div className={cn('flex flex-wrap items-center justify-between py-4')}>
          <div className='shrink-0 py-2 text-sm font-medium leading-[20px] text-gray-900'>
            {t('datasetSettings.form.name')}
          </div>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            className='h-9'
            placeholder={t('datasetSettings.form.namePlaceholder') || ''}
          />
        </div>
        <div className={cn('flex flex-wrap items-center justify-between py-4')}>
          <div className='shrink-0 py-2 text-sm font-medium leading-[20px] text-gray-900'>
            {t('datasetSettings.form.desc')}
          </div>
          <div className='w-full'>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className='resize-none'
              placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            />
          </div>
        </div>
      </div>
      <div className='flex justify-end pt-6'>
        <Button className='mr-2' onClick={onClose}>{t('common.operation.cancel')}</Button>
        <Button disabled={loading} variant="primary" onClick={onConfirm}>{t('common.operation.save')}</Button>
      </div>
    </Modal>
  )
}

export default RenameDatasetModal
