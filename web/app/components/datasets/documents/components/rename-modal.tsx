'use client'
import type { FC } from 'react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
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
      Toast.notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
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
      title={t('list.table.rename', { ns: 'datasetDocuments' })}
      isShow
      onClose={onClose}
    >
      <div className="mt-6 text-sm font-medium leading-[21px] text-text-primary">{t('list.table.name', { ns: 'datasetDocuments' })}</div>
      <Input
        className="mt-2 h-10"
        value={newName}
        onChange={e => setNewName(e.target.value)}
      />

      <div className="mt-10 flex justify-end">
        <Button className="mr-2 shrink-0" onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button variant="primary" className="shrink-0" onClick={handleSave} loading={saveLoading}>{t('operation.save', { ns: 'common' })}</Button>
      </div>
    </Modal>
  )
}
export default React.memo(RenameModal)
