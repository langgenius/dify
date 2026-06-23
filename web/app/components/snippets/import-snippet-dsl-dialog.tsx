'use client'

import type { MouseEventHandler } from 'react'
import type { SnippetDSLImportResponse } from '@/types/snippet'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
import {
  useConfirmSnippetImportMutation,
  useImportSnippetDSLMutation,
} from '@/service/use-snippets'
import { canCreateAndModifySnippets } from './utils/permission'

type ImportSnippetDSLDialogProps = {
  isOpen: boolean
  onClose: () => void
}

const ImportSnippetDSLDialogTab = {
  FromFile: 'from-file',
  FromUrl: 'from-url',
} as const

type ImportSnippetDSLDialogTab = typeof ImportSnippetDSLDialogTab[keyof typeof ImportSnippetDSLDialogTab]

const SnippetImportStatus = {
  Completed: 'completed',
  CompletedWithWarnings: 'completed-with-warnings',
  Failed: 'failed',
  Pending: 'pending',
} as const

const getImportedSnippetId = (response: SnippetDSLImportResponse) => response.snippet_id

function SnippetDSLConfirmDialog({
  versions = { importedVersion: '', systemVersion: '' },
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: {
  versions?: { importedVersion: string, systemVersion: string }
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: MouseEventHandler
}) {
  const { t } = useTranslation()

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <AlertDialogContent className="w-120 overflow-hidden! border-none text-left align-middle shadow-xl">
        <div className="flex flex-col items-start gap-2 self-stretch p-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
            {t('dslVersionMismatchTitle', { ns: 'snippet' })}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex grow flex-col system-md-regular text-text-secondary">
            <div>{t('dslVersionMismatchDescription', { ns: 'snippet' })}</div>
            <div>{t('dslVersionMismatchQuestion', { ns: 'snippet' })}</div>
            <br />
            <div>
              {t('importedDSLVersion', { ns: 'snippet' })}
              <span className="system-md-medium">{versions.importedVersion}</span>
            </div>
            <div>
              {t('currentDSLVersion', { ns: 'snippet' })}
              <span className="system-md-medium">{versions.systemVersion}</span>
            </div>
          </AlertDialogDescription>
        </div>
        <AlertDialogActions>
          <AlertDialogCancelButton variant="secondary">
            {t('operation.cancel', { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton onClick={onConfirm} disabled={confirmDisabled}>
            {t('operation.confirm', { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ImportSnippetDSLDialog({
  isOpen,
  onClose,
}: ImportSnippetDSLDialogProps) {
  const { t } = useTranslation()
  const { push } = useRouter()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canCreateAndModifySnippet = canCreateAndModifySnippets(workspacePermissionKeys)
  const importSnippetMutation = useImportSnippetDSLMutation()
  const confirmSnippetImportMutation = useConfirmSnippetImportMutation()
  const [currentTab, setCurrentTab] = useState<ImportSnippetDSLDialogTab>(ImportSnippetDSLDialogTab.FromFile)
  const [currentFile, setCurrentFile] = useState<File>()
  const [fileContent, setFileContent] = useState('')
  const [dslUrl, setDslUrl] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()

  const readFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      setFileContent(String(event.target?.result ?? ''))
    }
    reader.readAsText(file)
  }, [])

  const handleFileChange = useCallback((file?: File) => {
    setCurrentFile(file)
    if (file)
      readFile(file)
    else
      setFileContent('')
  }, [readFile])

  const handleImportSuccess = useCallback((response: SnippetDSLImportResponse) => {
    const snippetId = getImportedSnippetId(response)

    onClose()
    toast.success(t('importSuccess', { ns: 'snippet' }))

    if (snippetId)
      push(`/snippets/${snippetId}/orchestrate`)
  }, [onClose, push, t])

  const handleImportResponse = useCallback((response: SnippetDSLImportResponse) => {
    if (response.status === SnippetImportStatus.Completed || response.status === SnippetImportStatus.CompletedWithWarnings) {
      handleImportSuccess(response)
      return
    }

    if (response.status === SnippetImportStatus.Pending) {
      setVersions({
        importedVersion: response.imported_dsl_version ?? '',
        systemVersion: response.current_dsl_version ?? '',
      })
      setImportId(response.id)
      setShowConfirmModal(true)
      return
    }

    if (response.error)
      toast.error(response.error)
  }, [handleImportSuccess])

  const handleImport = useCallback(async () => {
    if (!canCreateAndModifySnippet)
      return

    try {
      const response = await importSnippetMutation.mutateAsync({
        mode: currentTab === ImportSnippetDSLDialogTab.FromFile ? 'yaml-content' : 'yaml-url',
        yamlContent: currentTab === ImportSnippetDSLDialogTab.FromFile ? fileContent : undefined,
        yamlUrl: currentTab === ImportSnippetDSLDialogTab.FromUrl ? dslUrl : undefined,
      })

      handleImportResponse(response)
    }
    catch (error) {
      if (error instanceof Error && error.message)
        toast.error(error.message)
    }
  }, [canCreateAndModifySnippet, currentTab, dslUrl, fileContent, handleImportResponse, importSnippetMutation])

  const handleConfirmImport: MouseEventHandler = useCallback(async () => {
    if (!canCreateAndModifySnippet || !importId)
      return

    try {
      const response = await confirmSnippetImportMutation.mutateAsync({ importId })
      handleImportResponse(response)
    }
    catch (error) {
      if (error instanceof Error && error.message)
        toast.error(error.message)
    }
  }, [canCreateAndModifySnippet, confirmSnippetImportMutation, handleImportResponse, importId])

  const tabs = useMemo(() => [
    {
      key: ImportSnippetDSLDialogTab.FromFile,
      label: t('importFromDSLFile', { ns: 'snippet' }),
    },
    {
      key: ImportSnippetDSLDialogTab.FromUrl,
      label: t('importFromDSLUrl', { ns: 'snippet' }),
    },
  ], [t])

  const isSubmitting = importSnippetMutation.isPending || confirmSnippetImportMutation.isPending
  const importDisabled = isSubmitting
    || !canCreateAndModifySnippet
    || (currentTab === ImportSnippetDSLDialogTab.FromFile && !currentFile)
    || (currentTab === ImportSnippetDSLDialogTab.FromUrl && !dslUrl.trim())

  return (
    <>
      <Dialog open={isOpen} onOpenChange={open => !open && !showConfirmModal && onClose()}>
        <DialogContent className="w-full max-w-120! overflow-hidden! rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0! text-left align-middle shadow-xl">
          <div className="flex items-center justify-between pt-6 pr-5 pb-3 pl-6 title-2xl-semi-bold text-text-primary">
            {t('importDialogTitle', { ns: 'snippet' })}
            <button
              type="button"
              aria-label={t('operation.close', { ns: 'common' })}
              className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover"
              onClick={onClose}
            >
              <span className="i-ri-close-line size-5" />
            </button>
          </div>
          <div className="flex h-9 items-center space-x-6 border-b border-divider-subtle px-6 system-md-semibold text-text-tertiary">
            {tabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  'relative flex h-full cursor-pointer items-center',
                  currentTab === tab.key && 'text-text-primary',
                )}
                onClick={() => setCurrentTab(tab.key)}
              >
                {tab.label}
                {currentTab === tab.key && (
                  <span className="absolute bottom-0 h-0.5 w-full bg-util-colors-blue-brand-blue-brand-600" />
                )}
              </button>
            ))}
          </div>
          <div className="px-6 py-4">
            {currentTab === ImportSnippetDSLDialogTab.FromFile && (
              <Uploader
                className="mt-0"
                file={currentFile}
                updateFile={handleFileChange}
              />
            )}
            {currentTab === ImportSnippetDSLDialogTab.FromUrl && (
              <div>
                <div className="mb-1 system-md-semibold text-text-secondary">DSL URL</div>
                <Input
                  placeholder={t('importFromDSLUrlPlaceholder', { ns: 'snippet' }) || ''}
                  value={dslUrl}
                  onChange={event => setDslUrl(event.target.value)}
                />
              </div>
            )}
          </div>
          <div className="flex justify-end px-6 py-5">
            <Button className="mr-2" disabled={isSubmitting} onClick={onClose}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              disabled={importDisabled}
              loading={isSubmitting}
              variant="primary"
              onClick={handleImport}
            >
              {t('operation.create', { ns: 'common' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {showConfirmModal && (
        <SnippetDSLConfirmDialog
          versions={versions}
          confirmDisabled={confirmSnippetImportMutation.isPending || !canCreateAndModifySnippet}
          onCancel={() => setShowConfirmModal(false)}
          onConfirm={handleConfirmImport}
        />
      )}
    </>
  )
}

export default ImportSnippetDSLDialog
