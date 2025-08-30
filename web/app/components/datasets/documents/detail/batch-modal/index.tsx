'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import CSVUploader from './csv-uploader'
import CSVDownloader from './csv-downloader'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import type { ChunkingMode, FileItem } from '@/models/datasets'
import { noop } from 'lodash-es'

export type IBatchModalProps = {
  isShow: boolean
  docForm: ChunkingMode
  onCancel: () => void
  onConfirm: (file: FileItem) => void
}

const BatchModal: FC<IBatchModalProps> = ({
  isShow,
  docForm,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation()
  const [currentCSV, setCurrentCSV] = useState<FileItem>()
  const handleFile = (file?: FileItem) => setCurrentCSV(file)

  const handleSend = () => {
    if (!currentCSV)
      return
    onCancel()
    onConfirm(currentCSV)
  }

  useEffect(() => {
    if (!isShow)
      setCurrentCSV(undefined)
  }, [isShow])

  return (
    <Modal isShow={isShow} onClose={noop} className='!max-w-[520px] !rounded-xl px-8 py-6'>
      <div className='relative pb-1 text-xl font-medium leading-[30px] text-text-primary'>{t('datasetDocuments.list.batchModal.title')}</div>
      <div className='absolute right-4 top-4 cursor-pointer p-2' onClick={onCancel}>
        <RiCloseLine className='h-4 w-4 text-text-secondary' />
      </div>
      <CSVUploader
        file={currentCSV}
        updateFile={handleFile}
      />
      <CSVDownloader
        docForm={docForm}
      />
      <div className='mt-[28px] flex justify-end pt-6'>
        <Button className='mr-2' onClick={onCancel}>
          {t('datasetDocuments.list.batchModal.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSend} disabled={!currentCSV || !currentCSV.file || !currentCSV.file.id}>
          {t('datasetDocuments.list.batchModal.run')}
        </Button>
      </div>
    </Modal>
  )
}
export default React.memo(BatchModal)
