'use client'
import type { FC } from 'react'
import type { ChunkingMode, FileItem } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CSVDownloader from './csv-downloader'
import CSVUploader from './csv-uploader'

type IBatchModalProps = {
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
    <Dialog open={isShow} disablePointerDismissal>
      <DialogContent className="w-[520px]! overflow-hidden! rounded-xl! border-0! px-8 py-6">
        <DialogTitle className="relative pb-1 text-xl leading-[30px] font-medium text-text-primary">{t('list.batchModal.title', { ns: 'datasetDocuments' })}</DialogTitle>
        <button
          type="button"
          className="absolute top-4 right-4 cursor-pointer p-2"
          aria-label={t('list.batchModal.cancel', { ns: 'datasetDocuments' })}
          onClick={onCancel}
        >
          <span className="i-ri-close-line h-4 w-4 text-text-secondary" />
        </button>
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
    </Dialog>
  )
}
export default React.memo(BatchModal)
