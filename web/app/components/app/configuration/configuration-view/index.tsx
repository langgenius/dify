'use client'
import type { FC } from 'react'
import type { ConfigurationViewModel } from '../hooks/configuration-view-model'
import type { InstallBundleCompleteCallback } from '@/app/components/plugins/install-plugin/install-bundle'
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
import { produce } from 'immer'
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
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { AppModeEnum, ModelModeType } from '@/types/app'
import { LegacyAgentBadge } from './legacy-agent-badge'

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
  const showLegacyAgentBadge = isAgentV2Enabled() && contextValue.mode === AppModeEnum.AGENT_CHAT
  const handlePluginInstallComplete: InstallBundleCompleteCallback = (plugins, installStatus) => {
    if (!installStatus.some((status) => status.success)) return

    const installedPluginNames = plugins.map((plugin) => `${plugin.plugin_id}/${plugin.name}`)
    const nextModelConfig = produce(contextValue.modelConfig, (draft) => {
      draft.agentConfig.tools.forEach((tool) => {
        if (
          'provider_id' in tool &&
          tool.isDeleted &&
          installedPluginNames.includes(tool.provider_id)
        ) {
          tool.isDeleted = false
        }
      })
    })
    contextValue.setModelConfig(nextModelConfig)
  }

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
        <>
          <div className="flex h-full flex-col">
            <div className="relative flex h-50 grow pt-14">
              <div className="bg-default-subtle absolute top-0 left-0 h-14 w-full">
                <div className="flex h-14 items-center justify-between px-6">
                  <div className="flex items-center gap-2">
                    <div className="system-xl-semibold text-text-primary">
                      {t(($) => $.orchestrate, { ns: 'appDebug' })}
                    </div>
                    {showLegacyAgentBadge && <LegacyAgentBadge />}
                    {isAdvancedMode && (
                      <div className="flex h-5 items-center rounded-md border border-components-button-secondary-border px-1.5 system-xs-medium-uppercase text-text-tertiary uppercase">
                        {t(($) => $['promptMode.advanced'], { ns: 'appDebug' })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center">
                    {isAgent && (
                      <AgentSettingButton
                        isChatModel={contextValue.modelModeType === ModelModeType.chat}
                        agentConfig={modelConfig.agentConfig}
                        isFunctionCall={contextValue.isFunctionCall}
                        disabled={contextValue.readonly}
                        onAgentSettingChange={onAgentSettingChange}
                      />
                    )}
                    {!debugWithMultipleModel && (
                      <>
                        <ModelParameterModal
                          isAdvancedMode={isAdvancedMode}
                          modelSelectorPopupClassName="w-108"
                          provider={modelConfig.provider}
                          completionParams={contextValue.completionParams}
                          modelId={modelConfig.model_id}
                          readonly={contextValue.readonly}
                          setModel={onModelChange}
                          onCompletionParamsChange={onCompletionParamsChange}
                          debugWithMultipleModel={debugWithMultipleModel}
                          onDebugWithMultipleModelChange={onEnableMultipleModelDebug}
                        />
                        <Divider type="vertical" className="mx-2 h-3.5" />
                      </>
                    )}
                    {isMobile && (
                      <Button
                        className="mr-2 h-8! text-[13px]! font-medium"
                        onClick={onOpenDebugPanel}
                      >
                        <span>{t(($) => $['operation.debugConfig'], { ns: 'appDebug' })}</span>
                        <CodeBracketIcon className="size-4 text-text-tertiary" />
                      </Button>
                    )}
                    <AppPublisher {...appPublisherProps} />
                  </div>
                </div>
              </div>
              <div
                className={`flex size-full shrink-0 flex-col sm:w-1/2 ${debugWithMultipleModel && 'max-w-140'}`}
              >
                <Config />
              </div>
              {!isMobile && (
                <div
                  className="relative flex h-full w-1/2 grow flex-col overflow-y-auto"
                  style={{ borderColor: 'rgba(0, 0, 0, 0.02)' }}
                >
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

          <AlertDialog
            open={showUseGPT4Confirm}
            onOpenChange={(open) => !open && setShowUseGPT4Confirm(false)}
          >
            <AlertDialogContent>
              <div className="flex flex-col items-start gap-2 self-stretch px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full title-2xl-semi-bold text-text-primary">
                  {t(($) => $['trailUseGPT4Info.title'], { ns: 'appDebug' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t(($) => $['trailUseGPT4Info.description'], { ns: 'appDebug' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton tone="default">
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  variant="primary"
                  tone="default"
                  onClick={onConfirmUseGPT4}
                >
                  {t(($) => $['operation.confirm'], { ns: 'common' })}
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
                if (!open) onHideDebugPanel()
              }}
            >
              <DrawerPortal>
                <DrawerBackdrop className="bg-black/30" />
                <DrawerViewport>
                  <DrawerPopup className="data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-sm">
                    <DrawerContent className="flex min-h-0 flex-1 flex-col">
                      <div className="mb-4 flex shrink-0 justify-end">
                        <DrawerCloseButton
                          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                          className="size-6 rounded-md"
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
              disabled={!!contextValue.readonly}
              onChange={onFeaturesChange}
              onClose={onCloseFeaturePanel}
              promptVariables={promptVariables}
              onAutoAddPromptVariable={onAutoAddPromptVariable}
            />
          )}
          <PluginDependency onInstallComplete={isAgent ? handlePluginInstallComplete : undefined} />
        </>
      </FeaturesProvider>
    </ConfigContext.Provider>
  )
}

export default React.memo(ConfigurationView)
