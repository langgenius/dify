'use client'

import { RiCloseLine, RiExternalLinkLine } from '@remixicon/react'
import { useDebounceFn, useKeyPress } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { trackEvent } from '@/app/components/base/amplitude'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import {
  importAppBundle,
  importDSL,
  importDSLConfirm,
} from '@/service/apps'
import { getRedirection } from '@/utils/app-redirection'
import { cn } from '@/utils/classnames'
import DSLConfirmModal from './dsl-confirm-modal'
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
  const docLink = useDocLink()
  const { notify } = useContext(ToastContext)
  const [currentFile, setDSLFile] = useState<File | undefined>(droppedFile)
  const [fileContent, setFileContent] = useState<string>()
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [dslUrlValue, setDslUrlValue] = useState(dslUrl)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const { handleCheckPluginDependencies } = usePluginDependencies()

  const isZipFile = (file?: File) => !!file && file.name.toLowerCase().endsWith('.zip')

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = function (event) {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }

  const handleFile = (file?: File) => {
    setDSLFile(file)
    if (file && !isZipFile(file))
      readFile(file)
    if (!file || isZipFile(file))
      setFileContent('')
  }

  const { isCurrentWorkspaceEditor } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const isCreatingRef = useRef(false)

  useEffect(() => {
    if (droppedFile)
      handleFile(droppedFile)
  }, [droppedFile])

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
        if (isZipFile(currentFile)) {
          response = await importAppBundle({ file: currentFile! })
        }
        else {
          response = await importDSL({
            mode: DSLImportMode.YAML_CONTENT,
            yaml_content: fileContent || '',
          })
        }
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
        // Track app creation from DSL import
        trackEvent('create_app_with_dsl', {
          app_mode,
          creation_method: currentTab === CreateFromDSLModalTab.FROM_FILE ? 'dsl_file' : 'dsl_url',
          has_warnings: status === DSLImportStatus.COMPLETED_WITH_WARNINGS,
        })

        if (onSuccess)
          onSuccess()
        if (onClose)
          onClose()

        notify({
          type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
          message: t(status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution', { ns: 'app' }),
          children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('newApp.appCreateDSLWarning', { ns: 'app' }),
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
        notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
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

  const onDSLConfirm = async () => {
    try {
      if (!importId)
        return
      const response = await importDSLConfirm({
        import_id: importId,
      })

      const { status, app_id, app_mode } = response

      if (status === DSLImportStatus.COMPLETED) {
        if (onSuccess)
          onSuccess()
        if (onClose)
          onClose()

        notify({
          type: 'success',
          message: t('newApp.appCreated', { ns: 'app' }),
        })
        if (app_id)
          await handleCheckPluginDependencies(app_id)
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        getRedirection(isCurrentWorkspaceEditor, { id: app_id!, mode: app_mode }, push)
      }
      else if (status === DSLImportStatus.FAILED) {
        notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (e) {
      notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
    }
  }

  const handleConfirmSuccess = () => {
    if (onSuccess)
      onSuccess()
    onClose()
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
  const learnMoreLabel = t('importFromDSLModal.learnMore', {
    ns: 'app',
    defaultValue: t('newApp.learnMore', { ns: 'app' }),
  })

  return (
    <>
      <Modal
        className="w-[520px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl"
        isShow={show}
        onClose={noop}
      >
        <div className="flex items-start justify-between pb-3 pl-6 pr-5 pt-6">
          <div className="title-2xl-semi-bold text-text-primary">
            {t('importFromDSL', { ns: 'app' })}
          </div>
          <div
            className="flex h-8 w-8 cursor-pointer items-center justify-center"
            onClick={() => onClose()}
          >
            <RiCloseLine className="h-[18px] w-[18px] text-text-tertiary" />
          </div>
        </div>
        <div className="border-b border-divider-subtle px-6">
          <div className="system-md-semibold flex h-9 items-center gap-6 text-text-tertiary">
            {tabs.map(tab => (
              <div
                key={tab.key}
                className={cn(
                  'relative flex h-full cursor-pointer items-center',
                  currentTab === tab.key && 'text-text-primary',
                )}
                onClick={() => setCurrentTab(tab.key)}
              >
                {tab.label}
                {currentTab === tab.key && (
                  <div className="absolute bottom-0 h-[2px] w-full bg-util-colors-blue-brand-blue-brand-600"></div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4">
          {currentTab === CreateFromDSLModalTab.FROM_FILE && (
            <Uploader
              className="mt-0"
              file={currentFile}
              updateFile={handleFile}
              accept=".yaml,.yml,.zip"
              displayName={isZipFile(currentFile) ? 'ZIP' : 'YAML'}
            />
          )}
          {currentTab === CreateFromDSLModalTab.FROM_URL && (
            <div>
              <div className="system-md-semibold mb-1 text-text-secondary">
                {t('importFromDSLUrl', { ns: 'app' })}
              </div>
              <Input
                placeholder={t('importFromDSLUrlPlaceholder', { ns: 'app' }) || ''}
                value={dslUrlValue}
                onChange={e => setDslUrlValue(e.target.value)}
              />
            </div>
          )}
        </div>
        {isAppsFull && (
          <div className="px-6">
            <AppsFull className="mt-0" loc="app-create-dsl" />
          </div>
        )}
        <div className="flex items-center justify-between px-6 pb-6 pt-5">
          <a
            className="system-xs-regular flex items-center gap-1 text-text-accent"
            href={docLink('/use-dify/workspace/app-management#app-export-and-import')}
            target="_blank"
            rel="noopener noreferrer"
          >
            {learnMoreLabel}
            <RiExternalLinkLine className="h-[12px] w-[12px]" />
          </a>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t('newApp.Cancel', { ns: 'app' })}
            </Button>
            <Button
              disabled={buttonDisabled}
              variant="primary"
              onClick={handleCreateApp}
            >
              {t('newApp.import', { ns: 'app' })}
            </Button>
          </div>
        </div>
      </Modal>
      {showErrorModal && (
        <DSLConfirmModal
          file={currentFile}
          versions={versions}
          onCancel={() => setShowErrorModal(false)}
          onConfirm={onDSLConfirm}
          onSuccess={handleConfirmSuccess}
        />
      )}
    </>
  )
}

export default CreateFromDSLModal
