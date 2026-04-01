'use client'

import type { ChangeEvent, DragEvent } from 'react'
import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import { useExistingSkillNames } from '../hooks/file-tree/data/use-skill-asset-tree'
import { extractAndValidateZip, ZipValidationError } from '../utils/zip-extract'
import { buildUploadDataFromZip } from '../utils/zip-to-upload-tree'
import { useSkillBatchUpload } from './use-skill-batch-upload'

const NS = 'workflow'
const PREFIX = 'skill.startTab.importModal'

const ZIP_ERROR_I18N_KEYS = {
  zip_too_large: `${PREFIX}.fileTooLarge`,
  extracted_too_large: `${PREFIX}.errorExtractedTooLarge`,
  too_many_files: `${PREFIX}.errorTooManyFiles`,
  path_traversal: `${PREFIX}.errorPathTraversal`,
  empty_zip: `${PREFIX}.errorEmptyZip`,
  invalid_zip: `${PREFIX}.errorInvalidZip`,
  no_root_folder: `${PREFIX}.errorNoRootFolder`,
} as const

type ImportSkillModalProps = {
  isOpen: boolean
  onClose: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const ImportSkillModal = ({ isOpen, onClose }: ImportSkillModalProps) => {
  const { t } = useTranslation()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const {
    appId,
    startUpload,
    setUploadProgress,
    failUpload,
    uploadTree,
    openCreatedSkillDocument,
  } = useSkillBatchUpload()

  const { data: existingNames } = useExistingSkillNames()

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleClose = useCallback(() => {
    if (isImporting)
      return
    setSelectedFile(null)
    onClose()
  }, [isImporting, onClose])

  const validateAndSetFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error(t(`${PREFIX}.invalidFileType`, { ns: NS }))
      return
    }
    setSelectedFile(file)
  }, [t])

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file)
      validateAndSetFile(file)
    e.target.value = ''
  }, [validateAndSetFile])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file)
      validateAndSetFile(file)
  }, [validateAndSetFile])

  const handleImport = useCallback(async () => {
    if (!selectedFile || !appId)
      return

    setIsImporting(true)
    startUpload(0)

    try {
      const zipData = await selectedFile.arrayBuffer()
      const extracted = await extractAndValidateZip(zipData)

      if (existingNames?.has(extracted.rootFolderName)) {
        toast.error(t(`${PREFIX}.nameDuplicate`, { ns: NS }))
        failUpload()
        setIsImporting(false)
        return
      }

      const { tree, files } = await buildUploadDataFromZip(extracted)
      setUploadProgress(0, files.size)
      const createdNodes = await uploadTree({ tree, files })
      openCreatedSkillDocument(createdNodes)

      toast.success(t(`${PREFIX}.importSuccess`, { ns: NS, name: extracted.rootFolderName }))
      onClose()
    }
    catch (error) {
      failUpload()
      if (error instanceof ZipValidationError) {
        const i18nKey = ZIP_ERROR_I18N_KEYS[error.code as keyof typeof ZIP_ERROR_I18N_KEYS]
        toast.error(i18nKey ? t(i18nKey, { ns: NS }) : error.message)
      }
      else {
        toast.error(t(`${PREFIX}.errorInvalidZip`, { ns: NS }))
      }
    }
    finally {
      setIsImporting(false)
      setSelectedFile(null)
    }
  }, [selectedFile, appId, startUpload, existingNames, setUploadProgress, uploadTree, openCreatedSkillDocument, t, onClose, failUpload])

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open)
          handleClose()
      }}
      disablePointerDismissal={isImporting}
    >
      <DialogContent>
        {!isImporting && <DialogCloseButton />}
        <DialogTitle className="text-text-primary title-2xl-semi-bold">
          {t(`${PREFIX}.title`, { ns: NS })}
        </DialogTitle>
        <div className="mt-6">
          {!selectedFile
            ? (
                <div
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-8 transition-colors ${isDragOver ? 'border-components-button-primary-border bg-state-accent-hover' : 'border-divider-regular bg-components-panel-bg-blur'}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="i-ri-upload-cloud-2-line mb-2 size-8 text-text-tertiary" />
                  <p className="text-text-tertiary system-sm-regular">
                    {t(`${PREFIX}.dropHint`, { ns: NS })}
                    {' '}
                    <span className="text-text-accent system-sm-medium">
                      {t(`${PREFIX}.browseFiles`, { ns: NS })}
                    </span>
                  </p>
                </div>
              )
            : (
                <div className="flex items-center justify-between rounded-xl border border-divider-regular bg-components-panel-bg-blur px-4 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-text-secondary system-sm-medium">{selectedFile.name}</span>
                    <span className="text-text-tertiary system-xs-regular">{formatFileSize(selectedFile.size)}</span>
                  </div>
                  <Button
                    size="small"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                  >
                    {t(`${PREFIX}.changeFile`, { ns: NS })}
                  </Button>
                </div>
              )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            onClick={handleClose}
            disabled={isImporting}
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={!selectedFile || isImporting}
            loading={isImporting}
          >
            {t(`${PREFIX}.importButton`, { ns: NS })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(ImportSkillModal)
