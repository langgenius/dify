'use client'
import type { FC } from 'react'
import type { ConfigurationViewModel } from './hooks/use-configuration'
import { CodeBracketIcon } from '@heroicons/react/20/solid'
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
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppPublisher from '@/app/components/app/app-publisher/features-wrapper'
import Config from '@/app/components/app/configuration/config'
import EditHistoryModal from '@/app/components/app/configuration/config-prompt/conversation-history/edit-modal'
import AgentSettingButton from '@/app/components/app/configuration/config/agent-setting-button'
import SelectDataSet from '@/app/components/app/configuration/dataset-config/select-dataset'
import Debug from '@/app/components/app/configuration/debug'
import Divider from '@/app/components/base/divider'
import { FeaturesProvider } from '@/app/components/base/features'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'
import Loading from '@/app/components/base/loading'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import PluginDependency from '@/app/components/workflow/plugin-dependency'
import ConfigContext from '@/context/debug-configuration'
import { MittProvider } from '@/context/mitt-context-provider'
import { AppModeEnum, ModelModeType } from '@/types/app'

const ConfigurationView: FC<ConfigurationViewModel> = ({
  appPublisherProps,
  contextValue,
  featuresData,
  isAgent,
  isAdvancedMode,
  isMobile,
  isShowDebugPanel,
  isShowHistoryModal,
  isShowSelectDataSet,
  modelConfig,
  multipleModelConfigs,
  onAutoAddPromptVariable,
  onAgentSettingChange,
  onCloseFeaturePanel,
  onCloseHistoryModal,
  onCloseSelectDataSet,
  onCompletionParamsChange,
  onConfirmUseGPT4,
  onEnableMultipleModelDebug,
  onFeaturesChange,
  onHideDebugPanel,
  onModelChange,
  onMultipleModelConfigsChange,
  onOpenAccountSettings,
  onOpenDebugPanel,
  onSaveHistory,
  onSelectDataSets,
  promptVariables,
  selectedIds,
  showAppConfigureFeaturesModal,
  showLoading,
  showUseGPT4Confirm,
  setShowUseGPT4Confirm,
}) => {
  const { t } = useTranslation()
  const debugWithMultipleModel = appPublisherProps.debugWithMultipleModel

  if (showLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }

  return (
    <ConfigContext.Provider value={contextValue}>
      <FeaturesProvider features={featuresData}>
        <MittProvider>
          <div className="flex h-full flex-col">
            <div className="relative flex h-[200px] grow pt-14">
              <div className="bg-default-subtle absolute top-0 left-0 h-14 w-full">
                <div className="flex h-14 items-center justify-between px-6">
                  <div className="flex items-center">
                    <div className="system-xl-semibold text-text-primary">{t('orchestrate', { ns: 'appDebug' })}</div>
                    <div className="flex h-[14px] items-center space-x-1 text-xs">
                      {isAdvancedMode && (
                        <div className="ml-1 flex h-5 items-center rounded-md border border-components-button-secondary-border px-1.5 system-xs-medium-uppercase text-text-tertiary uppercase">
                          {t('promptMode.advanced', { ns: 'appDebug' })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center">
                    {isAgent && (
                      <AgentSettingButton
                        isChatModel={contextValue.modelModeType === ModelModeType.chat}
                        agentConfig={modelConfig.agentConfig}
                        isFunctionCall={contextValue.isFunctionCall}
                        onAgentSettingChange={onAgentSettingChange}
                      />
                    )}
                    {!debugWithMultipleModel && (
                      <>
                        <ModelParameterModal
                          isAdvancedMode={isAdvancedMode}
                          provider={modelConfig.provider}
                          completionParams={contextValue.completionParams}
                          modelId={modelConfig.model_id}
                          setModel={onModelChange}
                          onCompletionParamsChange={onCompletionParamsChange}
                          debugWithMultipleModel={debugWithMultipleModel}
                          onDebugWithMultipleModelChange={onEnableMultipleModelDebug}
                        />
                        <Divider type="vertical" className="mx-2 h-[14px]" />
                      </>
                    )}
                    {isMobile && (
                      <Button className="mr-2 h-8! text-[13px]! font-medium" onClick={onOpenDebugPanel}>
                        <span className="mr-1">{t('operation.debugConfig', { ns: 'appDebug' })}</span>
                        <CodeBracketIcon className="h-4 w-4 text-text-tertiary" />
                      </Button>
                    )}
                    <AppPublisher {...appPublisherProps} />
                  </div>
                </div>
              </div>
              <div className={`flex h-full w-full shrink-0 flex-col sm:w-1/2 ${debugWithMultipleModel && 'max-w-[560px]'}`}>
                <Config />
              </div>
              {!isMobile && (
                <div className="relative flex h-full w-1/2 grow flex-col overflow-y-auto" style={{ borderColor: 'rgba(0, 0, 0, 0.02)' }}>
                  <div className="flex grow flex-col rounded-tl-2xl border-t-[0.5px] border-l-[0.5px] border-components-panel-border bg-chatbot-bg">
                    <Debug
                      isAPIKeySet={contextValue.isAPIKeySet}
                      onSetting={onOpenAccountSettings}
                      inputs={contextValue.inputs}
                      modelParameterParams={{
                        setModel: onModelChange,
                        onCompletionParamsChange,
                      }}
                      debugWithMultipleModel={!!debugWithMultipleModel}
                      multipleModelConfigs={multipleModelConfigs}
                      onMultipleModelConfigsChange={onMultipleModelConfigsChange}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <AlertDialog open={showUseGPT4Confirm} onOpenChange={open => !open && setShowUseGPT4Confirm(false)}>
            <AlertDialogContent>
              <div className="flex flex-col items-start gap-2 self-stretch px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full title-2xl-semi-bold text-text-primary">
                  {t('trailUseGPT4Info.title', { ns: 'appDebug' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t('trailUseGPT4Info.description', { ns: 'appDebug' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton tone="default">
                  {t('operation.cancel', { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton variant="primary" tone="default" onClick={onConfirmUseGPT4}>
                  {t('operation.confirm', { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>

          <SelectDataSet
            isShow={isShowSelectDataSet}
            onClose={onCloseSelectDataSet}
            selectedIds={selectedIds}
            onSelect={onSelectDataSets}
          />

          {isShowHistoryModal && (
            <EditHistoryModal
              isShow={isShowHistoryModal}
              saveLoading={false}
              onClose={onCloseHistoryModal}
              data={contextValue.completionPromptConfig.conversation_histories_role}
              onSave={onSaveHistory}
            />
          )}

          {isMobile && (
            <Drawer
              open={isShowDebugPanel}
              modal
              swipeDirection="right"
              onOpenChange={(open) => {
                if (!open)
                  onHideDebugPanel()
              }}
            >
              <DrawerPortal>
                <DrawerBackdrop className="bg-black/30" />
                <DrawerViewport>
                  <DrawerPopup className="data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-sm">
                    <DrawerContent className="flex min-h-0 flex-1 flex-col">
                      <div className="mb-4 flex shrink-0 justify-end">
                        <DrawerCloseButton
                          aria-label={t('operation.close', { ns: 'common' })}
                          className="h-6 w-6 rounded-md"
                        />
                      </div>
                      <Debug
                        isAPIKeySet={contextValue.isAPIKeySet}
                        onSetting={onOpenAccountSettings}
                        inputs={contextValue.inputs}
                        modelParameterParams={{
                          setModel: onModelChange,
                          onCompletionParamsChange,
                        }}
                        debugWithMultipleModel={!!debugWithMultipleModel}
                        multipleModelConfigs={multipleModelConfigs}
                        onMultipleModelConfigsChange={onMultipleModelConfigsChange}
                      />
                    </DrawerContent>
                  </DrawerPopup>
                </DrawerViewport>
              </DrawerPortal>
            </Drawer>
          )}

          {showAppConfigureFeaturesModal && (
            <NewFeaturePanel
              show
              inWorkflow={false}
              showFileUpload={false}
              isChatMode={contextValue.mode !== AppModeEnum.COMPLETION}
              disabled={false}
              onChange={onFeaturesChange}
              onClose={onCloseFeaturePanel}
              promptVariables={promptVariables}
              onAutoAddPromptVariable={onAutoAddPromptVariable}
            />
          )}
          <PluginDependency />
        </MittProvider>
      </FeaturesProvider>
    </ConfigContext.Provider>
  )
}

export default React.memo(ConfigurationView)
