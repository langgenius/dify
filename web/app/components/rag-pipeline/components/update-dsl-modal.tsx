'use client'

import {
  RiAlertFill,
  RiCloseLine,
  RiFileDownloadLine,
} from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { useUpdateDSLModal } from '../hooks/use-update-dsl-modal'
import VersionMismatchModal from './version-mismatch-modal'

type UpdateDSLModalProps = {
  onCancel: () => void
  onBackup: () => void
  onImport?: () => void
}

const UpdateDSLModal = ({
  onCancel,
  onBackup,
  onImport,
}: UpdateDSLModalProps) => {
  const { t } = useTranslation()
  const {
    currentFile,
    handleFile,
    show,
    showErrorModal,
    setShowErrorModal,
    loading,
    versions,
    handleImport,
    onUpdateDSLConfirm,
  } = useUpdateDSLModal({ onCancel, onImport })

  return (
    <>
      <Modal
        className="w-[520px] rounded-2xl p-6"
        isShow={show}
        onClose={onCancel}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="title-2xl-semi-bold text-text-primary">{t('common.importDSL', { ns: 'workflow' })}</div>
          <div className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center" onClick={onCancel}>
            <RiCloseLine className="h-[18px] w-[18px] text-text-tertiary" />
          </div>
        </div>
        <div className="relative mb-2 flex grow gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs">
          <div className="absolute left-0 top-0 h-full w-full bg-toast-warning-bg opacity-40" />
          <div className="flex items-start justify-center p-1">
            <RiAlertFill className="h-4 w-4 shrink-0 text-text-warning-secondary" />
          </div>
          <div className="flex grow flex-col items-start gap-0.5 py-1">
            <div className="system-xs-medium whitespace-pre-line text-text-primary">{t('common.importDSLTip', { ns: 'workflow' })}</div>
            <div className="flex items-start gap-1 self-stretch pb-0.5 pt-1">
              <Button
                size="small"
                variant="secondary"
                className="z-[1000]"
                onClick={onBackup}
              >
                <RiFileDownloadLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
                <div className="flex items-center justify-center gap-1 px-[3px]">
                  {t('common.backupCurrentDraft', { ns: 'workflow' })}
                </div>
              </Button>
            </div>
          </div>
        </div>
        <div>
          <div className="system-md-semibold pt-2 text-text-primary">
            {t('common.chooseDSL', { ns: 'workflow' })}
          </div>
          <div className="flex w-full flex-col items-start justify-center gap-4 self-stretch py-4">
            <Uploader
              file={currentFile}
              updateFile={handleFile}
              className="!mt-0 w-full"
              accept=".pipeline"
              displayName="PIPELINE"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 self-stretch pt-5">
          <Button onClick={onCancel}>{t('newApp.Cancel', { ns: 'app' })}</Button>
          <Button
            disabled={!currentFile || loading}
            variant="warning"
            onClick={handleImport}
            loading={loading}
          >
            {t('common.overwriteAndImport', { ns: 'workflow' })}
          </Button>
        </div>
      </Modal>
      <VersionMismatchModal
        isShow={showErrorModal}
        versions={versions}
        onClose={() => setShowErrorModal(false)}
        onConfirm={onUpdateDSLConfirm}
      />
    </>
  )
}

export default memo(UpdateDSLModal)
