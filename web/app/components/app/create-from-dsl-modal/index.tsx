'use client'

import type { MouseEventHandler } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useDebounceFn, useKeyPress } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import { useRouter } from '@/next/navigation'
import {
  importDSL,
  importDSLConfirm,
} from '@/service/apps'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import ShortcutsName from '../../workflow/shortcuts-name'
import Uploader from './uploader'

type CreateFromDSLModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
  activeTab?: string
  dslUrl?: string
  droppedFile?: File
}

export enum CreateFromDSLModalTab {
  FROM_FILE = 'from-file',
  FROM_URL = 'from-url',
}

const CreateFromDSLModal = ({ show, onSuccess, onClose, activeTab = CreateFromDSLModalTab.FROM_FILE, dslUrl = '', droppedFile }: CreateFromDSLModalProps) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const [currentFile, setCurrentFile] = useState<File | undefined>(droppedFile)
  const [fileContent, setFileContent] = useState<string>()
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [dslUrlValue, setDslUrlValue] = useState(dslUrl)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const { handleCheckPluginDependencies } = usePluginDependencies()

  const readFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = function (event) {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }, [])

  const handleFile = useCallback((file?: File) => {
    setCurrentFile(file)
    if (file)
      readFile(file)
    if (!file)
      setFileContent('')
  }, [readFile])

  const { isCurrentWorkspaceEditor } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const isCreatingRef = useRef(false)

  useEffect(() => {
    if (droppedFile)
      handleFile(droppedFile)
  }, [droppedFile, handleFile])

  const onCreate = async (_e?: React.MouseEvent) => {
    if (currentTab === CreateFromDSLModalTab.FROM_FILE && !currentFile)
      return
    if (currentTab === CreateFromDSLModalTab.FROM_URL && !dslUrlValue)
      return
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    try {
      let response

      if (currentTab === CreateFromDSLModalTab.FROM_FILE) {
        response = await importDSL({
          mode: DSLImportMode.YAML_CONTENT,
          yaml_content: fileContent || '',
        })
      }
      if (currentTab === CreateFromDSLModalTab.FROM_URL) {
        response = await importDSL({
          mode: DSLImportMode.YAML_URL,
          yaml_url: dslUrlValue || '',
        })
      }

      if (!response)
        return
      const { id, status, app_id, app_mode, imported_dsl_version, current_dsl_version } = response
      if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        trackCreateApp({ appMode: app_mode })

        if (onSuccess)
          onSuccess()
        if (onClose)
          onClose()

        toast(t(status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution', { ns: 'app' }), {
          type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
          description: status === DSLImportStatus.COMPLETED_WITH_WARNINGS
            ? t('newApp.appCreateDSLWarning', { ns: 'app' })
            : undefined,
        })
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        if (app_id)
          await handleCheckPluginDependencies(app_id)
        getRedirection(isCurrentWorkspaceEditor, { id: app_id!, mode: app_mode }, push)
      }
      else if (status === DSLImportStatus.PENDING) {
        setVersions({
          importedVersion: imported_dsl_version ?? '',
          systemVersion: current_dsl_version ?? '',
        })
        setTimeout(() => {
          setShowErrorModal(true)
        }, 300)
        setImportId(id)
      }
      else {
        toast.error(response.error || t('newApp.appCreateFailed', { ns: 'app' }))
      }
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
    isCreatingRef.current = false
  }

  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (show && !isAppsFull && ((currentTab === CreateFromDSLModalTab.FROM_FILE && currentFile) || (currentTab === CreateFromDSLModalTab.FROM_URL && dslUrlValue)))
      handleCreateApp(undefined)
  })

  useKeyPress('esc', () => {
    if (show && !showErrorModal)
      onClose()
  })

  const onDSLConfirm: MouseEventHandler = async () => {
    try {
      if (!importId)
        return
      const response = await importDSLConfirm({
        import_id: importId,
      })

      const { status, app_id, app_mode } = response

      if (status === DSLImportStatus.COMPLETED) {
        trackCreateApp({ appMode: app_mode })
        if (onSuccess)
          onSuccess()
        if (onClose)
          onClose()

        toast.success(t('newApp.appCreated', { ns: 'app' }))
        if (app_id)
          await handleCheckPluginDependencies(app_id)
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        getRedirection(isCurrentWorkspaceEditor, { id: app_id!, mode: app_mode }, push)
      }
      else if (status === DSLImportStatus.FAILED) {
        toast.error(response.error || t('newApp.appCreateFailed', { ns: 'app' }))
      }
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
    }
  }

  const tabs = [
    {
      key: CreateFromDSLModalTab.FROM_FILE,
      label: t('importFromDSLFile', { ns: 'app' }),
    },
    {
      key: CreateFromDSLModalTab.FROM_URL,
      label: t('importFromDSLUrl', { ns: 'app' }),
    },
  ]

  const buttonDisabled = useMemo(() => {
    if (isAppsFull)
      return true
    if (currentTab === CreateFromDSLModalTab.FROM_FILE)
      return !currentFile
    if (currentTab === CreateFromDSLModalTab.FROM_URL)
      return !dslUrlValue
    return false
  }, [isAppsFull, currentTab, currentFile, dslUrlValue])

  return (
    <>
      <Dialog open={show}>
        <DialogContent className="w-full max-w-[480px]! overflow-hidden! rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0! text-left align-middle shadow-xl">

          <div className="flex items-center justify-between pt-6 pr-5 pb-3 pl-6 title-2xl-semi-bold text-text-primary">
            {t('importApp', { ns: 'app' })}
            <div
              className="flex h-8 w-8 cursor-pointer items-center"
              onClick={() => onClose()}
            >
              <span className="i-ri-close-line h-5 w-5 text-text-tertiary" />
            </div>
          </div>
          <div className="flex h-9 items-center space-x-6 border-b border-divider-subtle px-6 system-md-semibold text-text-tertiary">
            {
              tabs.map(tab => (
                <div
                  key={tab.key}
                  className={cn(
                    'relative flex h-full cursor-pointer items-center',
                    currentTab === tab.key && 'text-text-primary',
                  )}
                  onClick={() => setCurrentTab(tab.key)}
                >
                  {tab.label}
                  {
                    currentTab === tab.key && (
                      <div className="absolute bottom-0 h-[2px] w-full bg-util-colors-blue-brand-blue-brand-600"></div>
                    )
                  }
                </div>
              ))
            }
          </div>
          <div className="px-6 py-4">
            {
              currentTab === CreateFromDSLModalTab.FROM_FILE && (
                <Uploader
                  className="mt-0"
                  file={currentFile}
                  updateFile={handleFile}
                />
              )
            }
            {
              currentTab === CreateFromDSLModalTab.FROM_URL && (
                <div>
                  <div className="mb-1 system-md-semibold text-text-secondary">DSL URL</div>
                  <Input
                    placeholder={t('importFromDSLUrlPlaceholder', { ns: 'app' }) || ''}
                    value={dslUrlValue}
                    onChange={e => setDslUrlValue(e.target.value)}
                  />
                </div>
              )
            }
          </div>
          {isAppsFull && (
            <div className="px-6">
              <AppsFull className="mt-0" loc="app-create-dsl" />
            </div>
          )}
          <div className="flex justify-end px-6 py-5">
            <Button className="mr-2" onClick={onClose}>{t('newApp.Cancel', { ns: 'app' })}</Button>
            <Button
              disabled={buttonDisabled}
              variant="primary"
              onClick={handleCreateApp}
              className="gap-1"
            >
              <span>{t('newApp.Create', { ns: 'app' })}</span>
              <ShortcutsName keys={['ctrl', '↵']} bgColor="white" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={showErrorModal}
        onOpenChange={(open) => {
          if (!open)
            setShowErrorModal(false)
        }}
      >
        <DialogContent className="w-full max-w-[480px]! overflow-hidden! border-none text-left align-middle">

          <div className="flex flex-col items-start gap-2 self-stretch pb-4">
            <div className="title-2xl-semi-bold text-text-primary">{t('newApp.appCreateDSLErrorTitle', { ns: 'app' })}</div>
            <div className="flex grow flex-col system-md-regular text-text-secondary">
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
            <Button variant="secondary" onClick={() => setShowErrorModal(false)}>{t('newApp.Cancel', { ns: 'app' })}</Button>
            <Button variant="primary" tone="destructive" onClick={onDSLConfirm}>{t('newApp.Confirm', { ns: 'app' })}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default CreateFromDSLModal
