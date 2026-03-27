'use client'

import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import { Dialog, DialogContent } from '@/app/components/base/ui/dialog'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { cn } from '@/utils/classnames'
import ShortcutsName from '../../workflow/shortcuts-name'
import DSLConfirmModal from './dsl-confirm-modal'
import Uploader from './uploader'
import { useCreateFromDSLModal } from './use-create-from-dsl-modal'

type CreateFromDSLModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
  activeTab?: CreateFromDSLModalTab
  dslUrl?: string
  droppedFile?: File
}

export enum CreateFromDSLModalTab {
  FROM_FILE = 'from-file',
  FROM_URL = 'from-url',
}

const appManagementLocalizedPathMap = {
  'zh-Hans': '/use-dify/workspace/app-management#应用导出和导入' as DocPathWithoutLang,
  'zh_Hans': '/use-dify/workspace/app-management#应用导出和导入' as DocPathWithoutLang,
  'ja-JP': '/use-dify/workspace/app-management#アプリのエクスポートとインポート' as DocPathWithoutLang,
  'ja_JP': '/use-dify/workspace/app-management#アプリのエクスポートとインポート' as DocPathWithoutLang,
} satisfies Record<string, DocPathWithoutLang>

const CreateFromDSLModal = ({ show, onSuccess, onClose, activeTab = CreateFromDSLModalTab.FROM_FILE, dslUrl = '', droppedFile }: CreateFromDSLModalProps) => {
  const { t } = useTranslation()
  const {
    buttonDisabled,
    currentFile,
    currentTab,
    docHref,
    dslUrlValue,
    handleConfirmSuccess,
    handleCreate,
    handleDSLConfirm,
    handleFile,
    isAppsFull,
    isCreating,
    isZipFile,
    learnMoreLabel,
    setCurrentTab,
    setDslUrlValue,
    setShowErrorModal,
    showErrorModal,
    tabs,
    versions,
  } = useCreateFromDSLModal({
    show,
    onSuccess,
    onClose,
    activeTab,
    dslUrl,
    droppedFile,
    appManagementLocalizedPathMap,
  })

  return (
    <>
      <Dialog
        open={show}
        onOpenChange={(open) => {
          if (!open)
            onClose()
        }}
      >
        <DialogContent className="w-[520px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl">
          <div className="flex items-center justify-between pb-3 pl-6 pr-5 pt-6 text-text-primary title-2xl-semi-bold">
            {t('importApp', { ns: 'app' })}
            <div
              className="flex h-8 w-8 cursor-pointer items-center justify-center"
              onClick={() => onClose()}
            >
              <span className="i-ri-close-line h-[18px] w-[18px] text-text-tertiary" aria-hidden="true" />
            </div>
          </div>
          <div className="flex h-9 items-center space-x-6 border-b border-divider-subtle px-6 text-text-tertiary system-md-semibold">
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
                  {currentTab === tab.key && (
                    <div className="absolute bottom-0 h-[2px] w-full bg-util-colors-blue-brand-blue-brand-600"></div>
                  )}
                </div>
              ))
            }
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
                <div className="mb-1 text-text-secondary system-md-semibold">
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
              className="flex items-center gap-1 text-text-accent system-xs-regular"
              href={docHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {learnMoreLabel}
              <span className="i-ri-external-link-line h-[12px] w-[12px]" aria-hidden="true" />
            </a>
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={onClose}>
                {t('newApp.Cancel', { ns: 'app' })}
              </Button>
              <Button
                disabled={buttonDisabled || isCreating}
                variant="primary"
                onClick={handleCreate}
                className="gap-1"
                loading={isCreating}
              >
                <span>{t('newApp.import', { ns: 'app' })}</span>
                <ShortcutsName keys={['ctrl', '↵']} bgColor="white" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {showErrorModal && (
        <DSLConfirmModal
          file={currentFile}
          versions={versions}
          onCancel={() => setShowErrorModal(false)}
          onConfirm={handleDSLConfirm}
          onSuccess={handleConfirmSuccess}
        />
      )}
    </>
  )
}

export default CreateFromDSLModal
