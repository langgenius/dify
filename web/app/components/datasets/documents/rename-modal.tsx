'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import Toast from '../../base/toast'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { renameDocumentName } from '@/service/datasets'

type Props = {
  datasetId: string
  documentId: string
  name: string
  onClose: () => void
  onSaved: () => void
}

const RenameModal: FC<Props> = ({
  documentId,
  datasetId,
  name,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation()

  const [newName, setNewName] = useState(name)
  const [saveLoading, {
    setTrue: setSaveLoadingTrue,
    setFalse: setSaveLoadingFalse,
  }] = useBoolean(false)

  const handleSave = async () => {
    setSaveLoadingTrue()
    try {
      await renameDocumentName({
        datasetId,
        documentId,
        name: newName,
      })
      Toast.notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onSaved()
      onClose()
    }
    catch (error) {
      if (error)
        Toast.notify({ type: 'error', message: error.toString() })
    }
    finally {
      setSaveLoadingFalse()
    }
  }

  return (
    <Modal
      title={t('datasetDocuments.list.table.rename')}
      isShow
      onClose={onClose}
    >
      <div className={'mt-6 font-medium text-sm leading-[21px] text-gray-900'}>{t('datasetDocuments.list.table.name')}</div>
      <input className={'mt-2 w-full rounded-lg h-10 box-border px-3 text-sm leading-10 bg-gray-100'}
        value={newName}
        onChange={e => setNewName(e.target.value)}
      />

      <div className='mt-10 flex justify-end'>
        <Button className='mr-2 flex-shrink-0' onClick={onClose}>{t('common.operation.cancel')}</Button>
        <Button variant='primary' className='flex-shrink-0' onClick={handleSave} loading={saveLoading}>{t('common.operation.save')}</Button>
      </div>
    </Modal>
  )
}
export default React.memo(RenameModal)
