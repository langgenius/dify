'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import {
  RiArrowDownDoubleLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { usePathname } from 'next/navigation'
import { useBoolean } from 'ahooks'
import type { LangFuseConfig, LangSmithConfig, OpikConfig, WeaveConfig } from './type'
import { TracingProvider } from './type'
import TracingIcon from './tracing-icon'
import ConfigButton from './config-button'
import cn from '@/utils/classnames'
import { LangfuseIcon, LangsmithIcon, OpikIcon, WeaveIcon } from '@/app/components/base/icons/src/public/tracing'
import Indicator from '@/app/components/header/indicator'
import { fetchTracingConfig as doFetchTracingConfig, fetchTracingStatus, updateTracingStatus } from '@/service/apps'
import type { TracingStatus } from '@/models/app'
import Toast from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import Loading from '@/app/components/base/loading'
import Divider from '@/app/components/base/divider'

const I18N_PREFIX = 'app.tracing'

const Title = ({
  className,
}: {
  className?: string
}) => {
  const { t } = useTranslation()

  return (
    <div className={cn('system-xl-semibold flex items-center text-text-primary', className)}>
      {t('common.appMenus.overview')}
    </div>
  )
}
const Panel: FC = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const { isCurrentWorkspaceEditor } = useAppContext()
  const readOnly = !isCurrentWorkspaceEditor

  const [isLoaded, {
    setTrue: setLoaded,
  }] = useBoolean(false)

  const [tracingStatus, setTracingStatus] = useState<TracingStatus | null>(null)
  const enabled = tracingStatus?.enabled || false
  const handleTracingStatusChange = async (tracingStatus: TracingStatus, noToast?: boolean) => {
    await updateTracingStatus({ appId, body: tracingStatus })
    setTracingStatus(tracingStatus)
    if (!noToast) {
      Toast.notify({
        type: 'success',
        message: t('common.api.success'),
      })
    }
  }

  const handleTracingEnabledChange = (enabled: boolean) => {
    handleTracingStatusChange({
      tracing_provider: tracingStatus?.tracing_provider || null,
      enabled,
    })
  }
  const handleChooseProvider = (provider: TracingProvider) => {
    handleTracingStatusChange({
      tracing_provider: provider,
      enabled: true,
    })
  }
  const inUseTracingProvider: TracingProvider | null = tracingStatus?.tracing_provider || null

  const InUseProviderIcon
    = inUseTracingProvider === TracingProvider.langSmith
      ? LangsmithIcon
      : inUseTracingProvider === TracingProvider.langfuse
        ? LangfuseIcon
        : inUseTracingProvider === TracingProvider.opik
          ? OpikIcon
          : inUseTracingProvider === TracingProvider.weave
            ? WeaveIcon
            : LangsmithIcon

  const [langSmithConfig, setLangSmithConfig] = useState<LangSmithConfig | null>(null)
  const [langFuseConfig, setLangFuseConfig] = useState<LangFuseConfig | null>(null)
  const [opikConfig, setOpikConfig] = useState<OpikConfig | null>(null)
  const [weaveConfig, setWeaveConfig] = useState<WeaveConfig | null>(null)
  const hasConfiguredTracing = !!(langSmithConfig || langFuseConfig || opikConfig || weaveConfig)

  const fetchTracingConfig = async () => {
    const { tracing_config: langSmithConfig, has_not_configured: langSmithHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.langSmith })
    if (!langSmithHasNotConfig)
      setLangSmithConfig(langSmithConfig as LangSmithConfig)
    const { tracing_config: langFuseConfig, has_not_configured: langFuseHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.langfuse })
    if (!langFuseHasNotConfig)
      setLangFuseConfig(langFuseConfig as LangFuseConfig)
    const { tracing_config: opikConfig, has_not_configured: OpikHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.opik })
    if (!OpikHasNotConfig)
      setOpikConfig(opikConfig as OpikConfig)
    const { tracing_config: weaveConfig, has_not_configured: weaveHasNotConfig } = await doFetchTracingConfig({ appId, provider: TracingProvider.weave })
    if (!weaveHasNotConfig)
      setWeaveConfig(weaveConfig as WeaveConfig)
  }

  const handleTracingConfigUpdated = async (provider: TracingProvider) => {
    // call api to hide secret key value
    const { tracing_config } = await doFetchTracingConfig({ appId, provider })
    if (provider === TracingProvider.langSmith)
      setLangSmithConfig(tracing_config as LangSmithConfig)
    else if (provider === TracingProvider.langfuse)
      setLangFuseConfig(tracing_config as LangFuseConfig)
    else if (provider === TracingProvider.opik)
      setOpikConfig(tracing_config as OpikConfig)
    else if (provider === TracingProvider.weave)
      setWeaveConfig(tracing_config as WeaveConfig)
  }

  const handleTracingConfigRemoved = (provider: TracingProvider) => {
    if (provider === TracingProvider.langSmith)
      setLangSmithConfig(null)
    else if (provider === TracingProvider.langfuse)
      setLangFuseConfig(null)
    else if (provider === TracingProvider.opik)
      setOpikConfig(null)
    else if (provider === TracingProvider.weave)
      setWeaveConfig(null)
    if (provider === inUseTracingProvider) {
      handleTracingStatusChange({
        enabled: false,
        tracing_provider: null,
      }, true)
    }
  }

  useEffect(() => {
    (async () => {
      const tracingStatus = await fetchTracingStatus({ appId })
      setTracingStatus(tracingStatus)
      await fetchTracingConfig()
      setLoaded()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [controlShowPopup, setControlShowPopup] = useState<number>(0)
  const showPopup = useCallback(() => {
    setControlShowPopup(Date.now())
  }, [setControlShowPopup])
  if (!isLoaded) {
    return (
      <div className='mb-3 flex items-center justify-between'>
        <Title className='h-[41px]' />
        <div className='w-[200px]'>
          <Loading />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('mb-3 flex items-center justify-between')}>
      <Title className='h-[41px]' />
      <div
        className={cn(
          'flex cursor-pointer items-center rounded-xl border-l-[0.5px] border-t border-effects-highlight bg-background-default-dodge p-2 shadow-xs hover:border-effects-highlight-lightmode-off hover:bg-background-default-lighter',
          controlShowPopup && 'border-effects-highlight-lightmode-off bg-background-default-lighter',
        )}
        onClick={showPopup}
      >
        {!inUseTracingProvider && (
          <>
            <TracingIcon size='md' />
            <div className='system-sm-semibold mx-2 text-text-secondary'>{t(`${I18N_PREFIX}.title`)}</div>
            <div className='flex items-center' onClick={e => e.stopPropagation()}>
              <ConfigButton
                appId={appId}
                readOnly={readOnly}
                hasConfigured={false}
                enabled={enabled}
                onStatusChange={handleTracingEnabledChange}
                chosenProvider={inUseTracingProvider}
                onChooseProvider={handleChooseProvider}
                langSmithConfig={langSmithConfig}
                langFuseConfig={langFuseConfig}
                opikConfig={opikConfig}
                weaveConfig={weaveConfig}
                onConfigUpdated={handleTracingConfigUpdated}
                onConfigRemoved={handleTracingConfigRemoved}
                controlShowPopup={controlShowPopup}
              />
            </div>
            <Divider type='vertical' className='h-3.5' />
            <div className='rounded-md p-1'>
              <RiArrowDownDoubleLine className='h-4 w-4 text-text-tertiary' />
            </div>
          </>
        )}
        {hasConfiguredTracing && (
          <>
            <div className='ml-4 mr-1 flex items-center'>
              <Indicator color={enabled ? 'green' : 'gray'} />
              <div className='system-xs-semibold-uppercase ml-1.5 text-text-tertiary'>
                {t(`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`)}
              </div>
            </div>
            {InUseProviderIcon && <InUseProviderIcon className='ml-1 h-4' />}
            <Divider type='vertical' className='h-3.5' />
            <div className='flex items-center' onClick={e => e.stopPropagation()}>
              <ConfigButton
                appId={appId}
                readOnly={readOnly}
                hasConfigured
                className='ml-2'
                enabled={enabled}
                onStatusChange={handleTracingEnabledChange}
                chosenProvider={inUseTracingProvider}
                onChooseProvider={handleChooseProvider}
                langSmithConfig={langSmithConfig}
                langFuseConfig={langFuseConfig}
                opikConfig={opikConfig}
                weaveConfig={weaveConfig}
                onConfigUpdated={handleTracingConfigUpdated}
                onConfigRemoved={handleTracingConfigRemoved}
                controlShowPopup={controlShowPopup}
              />
            </div>
          </>
        )}
      </div >
    </div >
  )
}
export default React.memo(Panel)
