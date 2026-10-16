'use client'
import type { FC } from 'react'
import type { ChunkingMode, FileItem } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
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

const BatchModalContent: FC<BatchModalContentProps> = ({ docForm, onCancel, onConfirm }) => {
  const { t } = useTranslation(['datasetDocuments'])
  const [currentCSV, setCurrentCSV] = useState<FileItem>()
  const handleFile = (file?: FileItem) => setCurrentCSV(file)

  const handleSend = () => {
    if (!currentCSV) return
    onCancel()
    onConfirm(currentCSV)
  }

  return (
    <DialogContent className="w-130">
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['list.batchModal.title'], { ns: 'datasetDocuments' })}
        </DialogTitle>
        <DialogCloseButton
          aria-label={t(($) => $['list.batchModal.cancel'], { ns: 'datasetDocuments' })}
        />
      </DialogHeader>
      <DialogBody>
        <CSVUploader file={currentCSV} updateFile={handleFile} />
        <CSVDownloader docForm={docForm} />
      </DialogBody>
      <DialogFooter>
        <Button onClick={onCancel}>
          {t(($) => $['list.batchModal.cancel'], { ns: 'datasetDocuments' })}
        </Button>
        <Button
          variant="primary"
          onClick={handleSend}
          disabled={!currentCSV || !currentCSV.file || !currentCSV.file.id}
        >
          {t(($) => $['list.batchModal.run'], { ns: 'datasetDocuments' })}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

const BatchModal: FC<IBatchModalProps> = ({ isShow, docForm, onCancel, onConfirm }) => {
  return (
    <Dialog open={isShow} onOpenChange={(open) => !open && onCancel()} disablePointerDismissal>
      {isShow ? (
        <BatchModalContent docForm={docForm} onCancel={onCancel} onConfirm={onConfirm} />
      ) : null}
    </Dialog>
  )
}

export default React.memo(BatchModal)
