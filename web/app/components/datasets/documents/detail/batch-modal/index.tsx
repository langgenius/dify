'use client'
import type { FC } from 'react'
import type { ChunkingMode, FileItem } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CSVDownloader from './csv-downloader'
import CSVUploader from './csv-uploader'

type IBatchModalProps = {
  isShow: boolean
  docForm: ChunkingMode
  onCancel: () => void
  onConfirm: (file: FileItem) => void
}

type BatchModalContentProps = Omit<IBatchModalProps, 'isShow'>

const BatchModalContent: FC<BatchModalContentProps> = ({
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

  return (
    <DialogContent className="w-[520px]! overflow-hidden! rounded-xl! border-0! px-8 py-6">
      <DialogTitle className="relative pb-1 text-xl leading-[30px] font-medium text-text-primary">{t('list.batchModal.title', { ns: 'datasetDocuments' })}</DialogTitle>
      <DialogCloseButton
        className="top-4 right-4"
        aria-label={t('list.batchModal.cancel', { ns: 'datasetDocuments' })}
      />
      <CSVUploader
        file={currentCSV}
        updateFile={handleFile}
      />
      <CSVDownloader
        docForm={docForm}
      />
      <div className="mt-[28px] flex justify-end pt-6">
        <Button className="mr-2" onClick={onCancel}>
          {t('list.batchModal.cancel', { ns: 'datasetDocuments' })}
        </Button>
        <Button variant="primary" onClick={handleSend} disabled={!currentCSV || !currentCSV.file || !currentCSV.file.id}>
          {t('list.batchModal.run', { ns: 'datasetDocuments' })}
        </Button>
      </div>
    </DialogContent>
  )
}

const BatchModal: FC<IBatchModalProps> = ({
  isShow,
  docForm,
  onCancel,
  onConfirm,
}) => {
  return (
    <Dialog
      open={isShow}
      onOpenChange={open => !open && onCancel()}
      disablePointerDismissal
    >
      {isShow
        ? (
            <BatchModalContent
              docForm={docForm}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          )
        : null}
    </Dialog>
  )
}

export default React.memo(BatchModal)
