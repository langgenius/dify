'use client'
import { useKeyPress } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import DSLConfirmModal from './dsl-confirm-modal'
import Header from './header'
import { CreateFromDSLModalTab, useDSLImport } from './hooks/use-dsl-import'
import Tab from './tab'
import Uploader from './uploader'

export { CreateFromDSLModalTab }

type CreateFromDSLModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
  activeTab?: CreateFromDSLModalTab
  dslUrl?: string
}

const CreateFromDSLModal = ({
  show,
  onSuccess,
  onClose,
  activeTab = CreateFromDSLModalTab.FROM_FILE,
  dslUrl = '',
}: CreateFromDSLModalProps) => {
  const { t } = useTranslation()

  const {
    currentFile,
    currentTab,
    dslUrlValue,
    showConfirmModal,
    versions,
    buttonDisabled,
    isConfirming,
    setCurrentTab,
    setDslUrlValue,
    handleFile,
    handleCreateApp,
    onDSLConfirm,
    handleCancelConfirm,
  } = useDSLImport({
    activeTab,
    dslUrl,
    onSuccess,
    onClose,
  })

  useKeyPress('esc', () => {
    if (show && !showConfirmModal)
      onClose()
  })

  return (
    <>
      <Modal
        className="w-[520px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl"
        isShow={show}
        onClose={noop}
      >
        <Header onClose={onClose} />
        <Tab
          currentTab={currentTab}
          setCurrentTab={setCurrentTab}
        />
        <div className="px-6 py-4">
          {currentTab === CreateFromDSLModalTab.FROM_FILE && (
            <Uploader
              className="mt-0"
              file={currentFile}
              updateFile={handleFile}
            />
          )}
          {currentTab === CreateFromDSLModalTab.FROM_URL && (
            <div>
              <div className="system-md-semibold leading6 mb-1 text-text-secondary">
                DSL URL
              </div>
              <Input
                placeholder={t('importFromDSLUrlPlaceholder', { ns: 'app' }) || ''}
                value={dslUrlValue}
                onChange={e => setDslUrlValue(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-x-2 p-6 pt-5">
          <Button onClick={onClose}>
            {t('newApp.Cancel', { ns: 'app' })}
          </Button>
          <Button
            disabled={buttonDisabled}
            variant="primary"
            onClick={handleCreateApp}
            className="gap-1"
          >
            <span>{t('newApp.import', { ns: 'app' })}</span>
          </Button>
        </div>
      </Modal>
      {showConfirmModal && (
        <DSLConfirmModal
          versions={versions}
          onCancel={handleCancelConfirm}
          onConfirm={onDSLConfirm}
          confirmDisabled={isConfirming}
        />
      )}
    </>
  )
}

export default CreateFromDSLModal
