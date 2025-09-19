'use client'

import type { MouseEventHandler } from 'react'
import { useCallback, useRef, useState } from 'react'
import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Modal from '@/app/components/base/modal'
import type { DataSet } from '@/models/datasets'
import { updateDatasetSetting } from '@/service/datasets'
import { noop } from 'lodash-es'
import AppIcon from '../../base/app-icon'
import type { AppIconSelection } from '../../base/app-icon-picker'
import AppIconPicker from '../../base/app-icon-picker'
import Toast from '../../base/toast'

type RenameDatasetModalProps = {
  show: boolean
  dataset: DataSet
  onSuccess?: () => void
  onClose: () => void
}

const RenameDatasetModal = ({ show, dataset, onSuccess, onClose }: RenameDatasetModalProps) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState<string>(dataset.name)
  const [description, setDescription] = useState<string>(dataset.description)
  const externalKnowledgeId = dataset.external_knowledge_info.external_knowledge_id
  const externalKnowledgeApiId = dataset.external_knowledge_info.external_knowledge_api_id
  const [appIcon, setAppIcon] = useState<AppIconSelection>(
    dataset.icon_info?.icon_type === 'image'
      ? { type: 'image' as const, url: dataset.icon_info?.icon_url || '', fileId: dataset.icon_info?.icon || '' }
      : { type: 'emoji' as const, icon: dataset.icon_info?.icon || '', background: dataset.icon_info?.icon_background || '' },
  )
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const previousAppIcon = useRef<AppIconSelection>(
    dataset.icon_info?.icon_type === 'image'
      ? { type: 'image' as const, url: dataset.icon_info?.icon_url || '', fileId: dataset.icon_info?.icon || '' }
      : { type: 'emoji' as const, icon: dataset.icon_info?.icon || '', background: dataset.icon_info?.icon_background || '' },
  )

  const handleOpenAppIconPicker = useCallback(() => {
    setShowAppIconPicker(true)
    previousAppIcon.current = appIcon
  }, [appIcon])

  const handleSelectAppIcon = useCallback((icon: AppIconSelection) => {
    setAppIcon(icon)
    setShowAppIconPicker(false)
  }, [])

  const handleCloseAppIconPicker = useCallback(() => {
    setAppIcon(previousAppIcon.current)
    setShowAppIconPicker(false)
  }, [])

  const onConfirm: MouseEventHandler = useCallback(async () => {
    if (!name.trim()) {
      Toast.notify({ type: 'error', message: t('datasetSettings.form.nameError') })
      return
    }
    try {
      setLoading(true)
      const body: Partial<DataSet> & { external_knowledge_id?: string; external_knowledge_api_id?: string } = {
        name,
        description,
        icon_info: {
          icon: appIcon.type === 'image' ? appIcon.fileId : appIcon.icon,
          icon_type: appIcon.type,
          icon_background: appIcon.type === 'image' ? undefined : appIcon.background,
          icon_url: appIcon.type === 'image' ? appIcon.url : undefined,
        },
      }
      if (externalKnowledgeId && externalKnowledgeApiId) {
        body.external_knowledge_id = externalKnowledgeId
        body.external_knowledge_api_id = externalKnowledgeApiId
      }
      await updateDatasetSetting({
        datasetId: dataset.id,
        body,
      })
      Toast.notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      if (onSuccess)
        onSuccess()
      onClose()
    }
    catch {
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
    finally {
      setLoading(false)
    }
  }, [appIcon, description, dataset.id, externalKnowledgeApiId, externalKnowledgeId, name, onClose, onSuccess, t])

  return (
    <Modal
      className='w-[520px] max-w-[520px] rounded-xl px-8 py-6'
      isShow={show}
      onClose={noop}
    >
      <div className='flex items-center justify-between pb-2'>
        <div className='text-xl font-medium leading-[30px] text-text-primary'>{t('datasetSettings.title')}</div>
        <div className='cursor-pointer p-2' onClick={onClose}>
          <RiCloseLine className='h-4 w-4 text-text-tertiary' />
        </div>
      </div>
      <div>
        <div className={cn('flex flex-col py-4')}>
          <div className='shrink-0 py-2 text-sm font-medium leading-[20px] text-text-primary'>
            {t('datasetSettings.form.name')}
          </div>
          <div className='flex items-center gap-x-2'>
            <AppIcon
              size='medium'
              onClick={handleOpenAppIconPicker}
              className='cursor-pointer'
              iconType={appIcon.type}
              icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
              background={appIcon.type === 'image' ? undefined : appIcon.background}
              imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
              showEditIcon
            />
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              className='h-9 grow'
              placeholder={t('datasetSettings.form.namePlaceholder') || ''}
            />
          </div>
        </div>
        <div className={cn('flex flex-col py-4')}>
          <div className='shrink-0 py-2 text-sm font-medium leading-[20px] text-text-primary'>
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
      {showAppIconPicker && (
        <AppIconPicker
          onSelect={handleSelectAppIcon}
          onClose={handleCloseAppIconPicker}
        />
      )}
    </Modal>
  )
}

export default RenameDatasetModal
