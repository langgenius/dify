'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useTranslation } from 'react-i18next'
import DSLConfirmModal from './dsl-confirm-modal'
import { CreateFromDSLModalTab, useDSLImport } from './hooks/use-dsl-import'
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

  return (
    <>
      <Dialog open={show} onOpenChange={(open) => !open && !showConfirmModal && onClose()}>
        <DialogContent className="w-full max-w-120! overflow-hidden! rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0! text-left align-middle shadow-xl">
          <div className="relative flex items-center justify-between pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $.importFromDSL, { ns: 'app' })}
            </DialogTitle>
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="absolute top-5 right-5"
              size="lg"
              onClick={onClose}
            >
              <span aria-hidden="true" className="i-ri-close-line size-4.5" />
            </IconButton>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              handleCreateApp()
            }}
          >
            <Tabs
              value={currentTab}
              onValueChange={(value) => {
                if (value !== null) setCurrentTab(value as CreateFromDSLModalTab)
              }}
            >
              <TabsList className="h-9 gap-6 border-b border-divider-subtle px-6">
                <TabsTab value={CreateFromDSLModalTab.FROM_FILE} className="h-full py-0">
                  {t(($) => $.importFromDSLFile, { ns: 'app' })}
                </TabsTab>
                <TabsTab value={CreateFromDSLModalTab.FROM_URL} className="h-full py-0">
                  {t(($) => $.importFromDSLUrl, { ns: 'app' })}
                </TabsTab>
              </TabsList>
              <TabsPanel
                value={CreateFromDSLModalTab.FROM_FILE}
                tabIndex={-1}
                className="px-6 py-4"
              >
                <Uploader className="mt-0" file={currentFile} updateFile={handleFile} />
              </TabsPanel>
              <TabsPanel value={CreateFromDSLModalTab.FROM_URL} tabIndex={-1} className="px-6 py-4">
                <Field name="dslUrl">
                  <FieldLabel className="w-full py-0 text-sm leading-5 font-semibold">
                    DSL URL
                  </FieldLabel>
                  <Input
                    autoComplete="off"
                    placeholder={t(($) => $.importFromDSLUrlPlaceholder, { ns: 'app' }) || ''}
                    value={dslUrlValue}
                    onChange={(e) => setDslUrlValue(e.target.value)}
                  />
                </Field>
              </TabsPanel>
            </Tabs>
            <div className="flex justify-end gap-2 p-6 pt-5">
              <Button type="button" onClick={onClose}>
                {t(($) => $['newApp.Cancel'], { ns: 'app' })}
              </Button>
              <Button type="submit" disabled={buttonDisabled} variant="primary">
                {t(($) => $['newApp.import'], { ns: 'app' })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
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
