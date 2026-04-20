'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { useDebounceFn, useKeyPress } from 'ahooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import Input from '@/app/components/base/input'
import { Button } from '@/app/components/base/ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import {
  useConfirmSnippetImportMutation,
  useImportSnippetDSLMutation,
} from '@/service/use-snippets'
import ShortcutsName from '../../workflow/shortcuts-name'

type SnippetImportDSLDialogProps = {
  show: boolean
  onClose: () => void
  onSuccess?: (snippetId: string) => void
}

const SnippetImportDSLTab = {
  FromFile: 'from-file',
  FromURL: 'from-url',
} as const

type SnippetImportDSLTabValue = typeof SnippetImportDSLTab[keyof typeof SnippetImportDSLTab]

const SnippetImportDSLDialog = ({
  show,
  onClose,
  onSuccess,
}: SnippetImportDSLDialogProps) => {
  const { t } = useTranslation()
  const importSnippetDSLMutation = useImportSnippetDSLMutation()
  const confirmSnippetImportMutation = useConfirmSnippetImportMutation()
  const [currentFile, setCurrentFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  const [currentTab, setCurrentTab] = useState<SnippetImportDSLTabValue>(SnippetImportDSLTab.FromFile)
  const [dslUrlValue, setDslUrlValue] = useState('')
  const [showVersionMismatchDialog, setShowVersionMismatchDialog] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()

  const isImporting = importSnippetDSLMutation.isPending || confirmSnippetImportMutation.isPending

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }

  const handleFile = (file?: File) => {
    setCurrentFile(file)
    if (file)
      readFile(file)
    if (!file)
      setFileContent('')
  }

  const completeImport = (snippetId?: string, status: string = DSLImportStatus.COMPLETED) => {
    if (!snippetId) {
      toast.error(t('importFailed', { ns: 'snippet' }))
      return
    }

    if (status === DSLImportStatus.COMPLETED_WITH_WARNINGS)
      toast.warning(t('newApp.appCreateDSLWarning', { ns: 'app' }))
    else
      toast.success(t('importSuccess', { ns: 'snippet' }))

    onSuccess?.(snippetId)
  }

  const handleImportResponse = (response: {
    id: string
    status: string
    snippet_id?: string
    imported_dsl_version?: string
    current_dsl_version?: string
  }) => {
    if (response.status === DSLImportStatus.COMPLETED || response.status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
      completeImport(response.snippet_id, response.status)
      return
    }

    if (response.status === DSLImportStatus.PENDING) {
      setVersions({
        importedVersion: response.imported_dsl_version ?? '',
        systemVersion: response.current_dsl_version ?? '',
      })
      setImportId(response.id)
      setShowVersionMismatchDialog(true)
      return
    }

    toast.error(t('importFailed', { ns: 'snippet' }))
  }

  const handleCreate = () => {
    if (currentTab === SnippetImportDSLTab.FromFile && !currentFile)
      return
    if (currentTab === SnippetImportDSLTab.FromURL && !dslUrlValue)
      return

    importSnippetDSLMutation.mutate({
      mode: currentTab === SnippetImportDSLTab.FromFile ? DSLImportMode.YAML_CONTENT : DSLImportMode.YAML_URL,
      yamlContent: currentTab === SnippetImportDSLTab.FromFile ? fileContent || '' : undefined,
      yamlUrl: currentTab === SnippetImportDSLTab.FromURL ? dslUrlValue : undefined,
    }, {
      onSuccess: handleImportResponse,
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('importFailed', { ns: 'snippet' }))
      },
    })
  }

  const { run: handleCreateSnippet } = useDebounceFn(handleCreate, { wait: 300 })

  const handleConfirmImport = () => {
    if (!importId)
      return

    confirmSnippetImportMutation.mutate({
      importId,
    }, {
      onSuccess: (response) => {
        setShowVersionMismatchDialog(false)
        completeImport(response.snippet_id)
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : t('importFailed', { ns: 'snippet' }))
      },
    })
  }

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (!show || showVersionMismatchDialog || isImporting)
      return

    if ((currentTab === SnippetImportDSLTab.FromFile && currentFile) || (currentTab === SnippetImportDSLTab.FromURL && dslUrlValue))
      handleCreateSnippet()
  })

  const buttonDisabled = useMemo(() => {
    if (isImporting)
      return true
    if (currentTab === SnippetImportDSLTab.FromFile)
      return !currentFile
    return !dslUrlValue
  }, [currentFile, currentTab, dslUrlValue, isImporting])

  return (
    <>
      <Dialog open={show} onOpenChange={open => !open && onClose()}>
        <DialogContent className="w-[520px] p-0">
          <div className="flex items-center justify-between pt-6 pr-5 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('importFromDSL', { ns: 'app' })}
            </DialogTitle>
            <DialogCloseButton className="top-6 right-5 h-8 w-8" />
          </div>

          <div className="system-md-semibold flex h-9 items-center space-x-6 border-b border-divider-subtle px-6 text-text-tertiary">
            {[
              { key: SnippetImportDSLTab.FromFile, label: t('importFromDSLFile', { ns: 'app' }) },
              { key: SnippetImportDSLTab.FromURL, label: t('importFromDSLUrl', { ns: 'app' }) },
            ].map(tab => (
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
                  <div className="absolute bottom-0 h-[2px] w-full bg-util-colors-blue-brand-blue-brand-600" />
                )}
              </button>
            ))}
          </div>

          <div className="px-6 py-4">
            {currentTab === SnippetImportDSLTab.FromFile && (
              <Uploader
                className="mt-0"
                file={currentFile}
                updateFile={handleFile}
              />
            )}
            {currentTab === SnippetImportDSLTab.FromURL && (
              <div>
                <div className="system-md-semibold mb-1 text-text-secondary">DSL URL</div>
                <Input
                  placeholder={t('importFromDSLUrlPlaceholder', { ns: 'app' }) || ''}
                  value={dslUrlValue}
                  onChange={e => setDslUrlValue(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end px-6 py-5">
            <Button className="mr-2" disabled={isImporting} onClick={onClose}>
              {t('newApp.Cancel', { ns: 'app' })}
            </Button>
            <Button
              disabled={buttonDisabled}
              variant="primary"
              onClick={handleCreateSnippet}
              className="gap-1"
            >
              <span>{t('newApp.Create', { ns: 'app' })}</span>
              <ShortcutsName keys={['ctrl', '↵']} bgColor="white" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showVersionMismatchDialog} onOpenChange={open => !open && setShowVersionMismatchDialog(false)}>
        <DialogContent className="w-[480px]">
          <div className="flex flex-col items-start gap-2 self-stretch pb-4">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}
            </DialogTitle>
            <div className="system-md-regular flex grow flex-col text-text-secondary">
              <div>{t('newApp.appCreateDSLErrorPart1', { ns: 'app' })}</div>
              <div>{t('newApp.appCreateDSLErrorPart2', { ns: 'app' })}</div>
              <br />
              <div>
                {t('newApp.appCreateDSLErrorPart3', { ns: 'app' })}
                <span className="system-md-medium">{versions?.importedVersion}</span>
              </div>
              <div>
                {t('newApp.appCreateDSLErrorPart4', { ns: 'app' })}
                <span className="system-md-medium">{versions?.systemVersion}</span>
              </div>
            </div>
          </div>
          <div className="flex items-start justify-end gap-2 self-stretch pt-6">
            <Button variant="secondary" disabled={isImporting} onClick={() => setShowVersionMismatchDialog(false)}>
              {t('newApp.Cancel', { ns: 'app' })}
            </Button>
            <Button variant="primary" tone="destructive" disabled={isImporting} onClick={handleConfirmImport}>
              {t('newApp.Confirm', { ns: 'app' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default SnippetImportDSLDialog
