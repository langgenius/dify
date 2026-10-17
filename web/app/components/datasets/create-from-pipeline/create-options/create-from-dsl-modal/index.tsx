'use client'
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
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
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
  const { t } = useTranslation(['app', 'common'])

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
        <DialogContent className="w-120">
          <DialogHeader>
            <DialogTitle>{t(($) => $.importFromDSL, { ns: 'app' })}</DialogTitle>
            <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
          </DialogHeader>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              handleCreateApp()
            }}
          >
            <Tabs
              className="contents"
              value={currentTab}
              onValueChange={(value) => {
                if (value !== null) setCurrentTab(value as CreateFromDSLModalTab)
              }}
            >
              <TabsList className="h-9 shrink-0 gap-6 border-b border-divider-subtle px-6">
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
                render={<DialogBody />}
              >
                <Uploader className="mt-0" file={currentFile} updateFile={handleFile} />
              </TabsPanel>
              <TabsPanel
                value={CreateFromDSLModalTab.FROM_URL}
                tabIndex={-1}
                render={<DialogBody />}
              >
                <Field name="dslUrl" className="gap-0">
                  <FieldLabel className="w-full text-sm leading-5 font-semibold">
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
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                {t(($) => $['newApp.Cancel'], { ns: 'app' })}
              </Button>
              <Button type="submit" disabled={buttonDisabled} variant="primary">
                {t(($) => $['newApp.import'], { ns: 'app' })}
              </Button>
            </DialogFooter>
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
