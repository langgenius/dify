import type { ComponentProps } from 'react'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import type { PromptVariable } from '@/models/debug'
import { useTranslation } from 'react-i18next'
import EditHistoryModal from '@/app/components/app/configuration/config-prompt/conversation-history/edit-modal'
import SelectDataSet from '@/app/components/app/configuration/dataset-config/select-dataset'
import Drawer from '@/app/components/base/drawer'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import PluginDependency from '@/app/components/workflow/plugin-dependency'
import ConfigurationDebugPanel from './configuration-debug-panel'

type ConfigurationDebugPanelProps = ComponentProps<typeof ConfigurationDebugPanel>

type ConfigurationModalsProps = {
  showUseGPT4Confirm: boolean
  onConfirmUseGPT4: () => void
  onCancelUseGPT4: () => void
  isShowSelectDataSet: boolean
  hideSelectDataSet: () => void
  selectedIds: string[]
  onSelectDataSet: ComponentProps<typeof SelectDataSet>['onSelect']
  isShowHistoryModal: boolean
  hideHistoryModal: () => void
  conversationHistoriesRole: ComponentProps<typeof EditHistoryModal>['data']
  setConversationHistoriesRole: (data: ComponentProps<typeof EditHistoryModal>['data']) => void
  isMobile: boolean
  isShowDebugPanel: boolean
  hideDebugPanel: () => void
  debugPanelProps: ConfigurationDebugPanelProps
  showAppConfigureFeaturesModal: boolean
  closeFeaturePanel: () => void
  mode: string
  handleFeaturesChange: OnFeaturesChange
  promptVariables: PromptVariable[]
  handleAddPromptVariable: (variables: PromptVariable[]) => void
}

const ConfigurationModals = ({
  showUseGPT4Confirm,
  onConfirmUseGPT4,
  onCancelUseGPT4,
  isShowSelectDataSet,
  hideSelectDataSet,
  selectedIds,
  onSelectDataSet,
  isShowHistoryModal,
  hideHistoryModal,
  conversationHistoriesRole,
  setConversationHistoriesRole,
  isMobile,
  isShowDebugPanel,
  hideDebugPanel,
  debugPanelProps,
  showAppConfigureFeaturesModal,
  closeFeaturePanel,
  mode,
  handleFeaturesChange,
  promptVariables,
  handleAddPromptVariable,
}: ConfigurationModalsProps) => {
  const { t } = useTranslation()

  return (
    <>
      {showUseGPT4Confirm && (
        <AlertDialog open={showUseGPT4Confirm} onOpenChange={open => !open && onCancelUseGPT4()}>
          <AlertDialogContent>
            <div className="flex flex-col items-start gap-2 self-stretch p-6 pb-4">
              <AlertDialogTitle className="text-text-primary title-2xl-semi-bold">
                {t('trailUseGPT4Info.title', { ns: 'appDebug' })}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full whitespace-pre-wrap break-words text-text-tertiary system-md-regular">
                {t('trailUseGPT4Info.description', { ns: 'appDebug' })}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
              <AlertDialogConfirmButton onClick={onConfirmUseGPT4}>
                {t('operation.confirm', { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {isShowSelectDataSet && (
        <SelectDataSet
          isShow={isShowSelectDataSet}
          onClose={hideSelectDataSet}
          selectedIds={selectedIds}
          onSelect={onSelectDataSet}
        />
      )}

      {isShowHistoryModal && (
        <EditHistoryModal
          isShow={isShowHistoryModal}
          saveLoading={false}
          onClose={hideHistoryModal}
          data={conversationHistoriesRole}
          onSave={(data) => {
            setConversationHistoriesRole(data)
            hideHistoryModal()
          }}
        />
      )}

      {isMobile && (
        <Drawer showClose isOpen={isShowDebugPanel} onClose={hideDebugPanel} mask footer={null}>
          <ConfigurationDebugPanel {...debugPanelProps} />
        </Drawer>
      )}

      {showAppConfigureFeaturesModal && (
        <NewFeaturePanel
          show
          inWorkflow={false}
          showFileUpload={false}
          isChatMode={mode !== 'completion'}
          disabled={false}
          onChange={handleFeaturesChange}
          onClose={closeFeaturePanel}
          promptVariables={promptVariables}
          onAutoAddPromptVariable={handleAddPromptVariable}
        />
      )}

      <PluginDependency />
    </>
  )
}

export default ConfigurationModals
