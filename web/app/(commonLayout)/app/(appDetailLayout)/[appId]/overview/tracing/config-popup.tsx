'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import TracingIcon from './tracing-icon'
import ProviderPanel from './provider-panel'
import type { LangFuseConfig, LangSmithConfig, OpikConfig } from './type'
import { TracingProvider } from './type'
import ProviderConfigModal from './provider-config-modal'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'

const I18N_PREFIX = 'app.tracing'

export type PopupProps = {
  appId: string
  readOnly: boolean
  enabled: boolean
  onStatusChange: (enabled: boolean) => void
  chosenProvider: TracingProvider | null
  onChooseProvider: (provider: TracingProvider) => void
  langSmithConfig: LangSmithConfig | null
  langFuseConfig: LangFuseConfig | null
  opikConfig: OpikConfig | null
  onConfigUpdated: (provider: TracingProvider, payload: LangSmithConfig | LangFuseConfig | OpikConfig) => void
  onConfigRemoved: (provider: TracingProvider) => void
}

const ConfigPopup: FC<PopupProps> = ({
  appId,
  readOnly,
  enabled,
  onStatusChange,
  chosenProvider,
  onChooseProvider,
  langSmithConfig,
  langFuseConfig,
  opikConfig,
  onConfigUpdated,
  onConfigRemoved,
}) => {
  const { t } = useTranslation()

  const [currentProvider, setCurrentProvider] = useState<TracingProvider | null>(TracingProvider.langfuse)
  const [isShowConfigModal, {
    setTrue: showConfigModal,
    setFalse: hideConfigModal,
  }] = useBoolean(false)
  const handleOnConfig = useCallback((provider: TracingProvider) => {
    return () => {
      setCurrentProvider(provider)
      showConfigModal()
    }
  }, [showConfigModal])

  const handleOnChoose = useCallback((provider: TracingProvider) => {
    return () => {
      onChooseProvider(provider)
    }
  }, [onChooseProvider])

  const handleConfigUpdated = useCallback((payload: LangSmithConfig | LangFuseConfig | OpikConfig) => {
    onConfigUpdated(currentProvider!, payload)
    hideConfigModal()
  }, [currentProvider, hideConfigModal, onConfigUpdated])

  const handleConfigRemoved = useCallback(() => {
    onConfigRemoved(currentProvider!)
    hideConfigModal()
  }, [currentProvider, hideConfigModal, onConfigRemoved])

  const providerAllConfigured = langSmithConfig && langFuseConfig && opikConfig
  const providerAllNotConfigured = !langSmithConfig && !langFuseConfig && !opikConfig

  const switchContent = (
    <Switch
      className='ml-3'
      defaultValue={enabled}
      onChange={onStatusChange}
      disabled={providerAllNotConfigured}
    />
  )
  const langSmithPanel = (
    <ProviderPanel
      type={TracingProvider.langSmith}
      readOnly={readOnly}
      config={langSmithConfig}
      hasConfigured={!!langSmithConfig}
      onConfig={handleOnConfig(TracingProvider.langSmith)}
      isChosen={chosenProvider === TracingProvider.langSmith}
      onChoose={handleOnChoose(TracingProvider.langSmith)}
      key="langSmith-provider-panel"
    />
  )

  const langfusePanel = (
    <ProviderPanel
      type={TracingProvider.langfuse}
      readOnly={readOnly}
      config={langFuseConfig}
      hasConfigured={!!langFuseConfig}
      onConfig={handleOnConfig(TracingProvider.langfuse)}
      isChosen={chosenProvider === TracingProvider.langfuse}
      onChoose={handleOnChoose(TracingProvider.langfuse)}
      key="langfuse-provider-panel"
    />
  )

  const opikPanel = (
    <ProviderPanel
      type={TracingProvider.opik}
      readOnly={readOnly}
      config={opikConfig}
      hasConfigured={!!opikConfig}
      onConfig={handleOnConfig(TracingProvider.opik)}
      isChosen={chosenProvider === TracingProvider.opik}
      onChoose={handleOnChoose(TracingProvider.opik)}
      key="opik-provider-panel"
    />
  )

  const configuredProviderPanel = () => {
    const configuredPanels: any[] = []

    if (langSmithConfig)
      configuredPanels.push(langSmithPanel)

    if (langFuseConfig)
      configuredPanels.push(langfusePanel)

    if (opikConfig)
      configuredPanels.push(opikPanel)

    return configuredPanels
  }

  const moreProviderPanel = () => {
    const notConfiguredPanels: any[] = []

    if (!langSmithConfig)
      notConfiguredPanels.push(langSmithPanel)

    if (!langFuseConfig)
      notConfiguredPanels.push(langfusePanel)

    if (!opikConfig)
      notConfiguredPanels.push(opikPanel)

    return notConfiguredPanels
  }

  const configuredProviderConfig = () => {
    if (currentProvider === TracingProvider.langSmith)
      return langSmithConfig
    if (currentProvider === TracingProvider.langfuse)
      return langFuseConfig
    return opikConfig
  }

  return (
    <div className='bg-components-panel-bg border-components-panel-border w-[420px] rounded-2xl border-[0.5px] p-4 shadow-xl'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center'>
          <TracingIcon size='md' className='mr-2' />
          <div className='text-text-primary title-2xl-semibold'>{t(`${I18N_PREFIX}.tracing`)}</div>
        </div>
        <div className='flex items-center'>
          <Indicator color={enabled ? 'green' : 'gray'} />
          <div className={cn('system-xs-semibold-uppercase text-text-tertiary ml-1', enabled && 'text-util-colors-green-green-600')}>
            {t(`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`)}
          </div>
          {!readOnly && (
            <>
              {providerAllNotConfigured
                ? (
                  <Tooltip
                    popupContent={t(`${I18N_PREFIX}.disabledTip`)}
                  >
                    {switchContent}
                  </Tooltip>
                )
                : switchContent}
            </>
          )}
        </div>
      </div>

      <div className='system-xs-regular text-text-tertiary mt-2'>
        {t(`${I18N_PREFIX}.tracingDescription`)}
      </div>
      <Divider className='my-3' />
      <div className='relative'>
        {(providerAllConfigured || providerAllNotConfigured)
          ? (
            <>
              <div className='system-xs-medium-uppercase text-text-tertiary'>{t(`${I18N_PREFIX}.configProviderTitle.${providerAllConfigured ? 'configured' : 'notConfigured'}`)}</div>
              <div className='mt-2 space-y-2'>
                {langSmithPanel}
                {langfusePanel}
                {opikPanel}
              </div>
            </>
          )
          : (
            <>
              <div className='system-xs-medium-uppercase text-text-tertiary'>{t(`${I18N_PREFIX}.configProviderTitle.configured`)}</div>
              <div className='mt-2 space-y-2'>
                {configuredProviderPanel()}
              </div>
              <div className='system-xs-medium-uppercase text-text-tertiary mt-3'>{t(`${I18N_PREFIX}.configProviderTitle.moreProvider`)}</div>
              <div className='mt-2 space-y-2'>
                {moreProviderPanel()}
              </div>
            </>
          )}

      </div>
      {isShowConfigModal && (
        <ProviderConfigModal
          appId={appId}
          type={currentProvider!}
          payload={configuredProviderConfig()}
          onCancel={hideConfigModal}
          onSaved={handleConfigUpdated}
          onChosen={onChooseProvider}
          onRemoved={handleConfigRemoved}
        />
      )}
    </div>
  )
}
export default React.memo(ConfigPopup)
