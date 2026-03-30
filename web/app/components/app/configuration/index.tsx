'use client'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ConfigurationDebugPanel from '@/app/components/app/configuration/components/configuration-debug-panel'
import ConfigurationHeaderActions from '@/app/components/app/configuration/components/configuration-header-actions'
import ConfigurationModals from '@/app/components/app/configuration/components/configuration-modals'
import Config from '@/app/components/app/configuration/config'
import { useConfigurationController } from '@/app/components/app/configuration/hooks/use-configuration-controller'
import { FeaturesProvider } from '@/app/components/base/features'
import Loading from '@/app/components/base/loading'
import ConfigContext from '@/context/debug-configuration'
import { MittProvider } from '@/context/mitt-context-provider'

const Configuration = () => {
  const { t } = useTranslation()
  const {
    currentWorkspaceId,
    featuresData,
    contextValue,
    debugPanelProps,
    headerActionsProps,
    isLoading,
    isLoadingCurrentWorkspace,
    isMobile,
    modalProps,
  } = useConfigurationController()

  if (isLoading || isLoadingCurrentWorkspace || !currentWorkspaceId) {
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
              <div className="bg-default-subtle absolute left-0 top-0 h-14 w-full">
                <div className="flex h-14 items-center justify-between px-6">
                  <div className="flex items-center">
                    <div className="text-text-primary system-xl-semibold">{t('orchestrate', { ns: 'appDebug' })}</div>
                    <div className="flex h-[14px] items-center space-x-1 text-xs">
                      {contextValue.isAdvancedMode && (
                        <div className="ml-1 flex h-5 items-center rounded-md border border-components-button-secondary-border px-1.5 uppercase text-text-tertiary system-xs-medium-uppercase">{t('promptMode.advanced', { ns: 'appDebug' })}</div>
                      )}
                    </div>
                  </div>
                  <ConfigurationHeaderActions {...headerActionsProps} />
                </div>
              </div>
              <div className={`flex h-full w-full shrink-0 flex-col sm:w-1/2 ${headerActionsProps.publisherProps.debugWithMultipleModel && 'max-w-[560px]'}`}>
                <Config />
              </div>
              {!isMobile && (
                <div className="relative flex h-full w-1/2 grow flex-col overflow-y-auto" style={{ borderColor: 'rgba(0, 0, 0, 0.02)' }}>
                  <div className="flex grow flex-col rounded-tl-2xl border-l-[0.5px] border-t-[0.5px] border-components-panel-border bg-chatbot-bg">
                    <ConfigurationDebugPanel {...debugPanelProps} />
                  </div>
                </div>
              )}
            </div>
          </div>
          <ConfigurationModals {...modalProps} />
        </MittProvider>
      </FeaturesProvider>
    </ConfigContext.Provider>
  )
}
export default React.memo(Configuration)
