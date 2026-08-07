'use client'

import type { FC } from 'react'
import type { TracingStatus } from '@/models/app'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Divider from '@/app/components/base/divider'
import {
  AliyunIcon,
  ArizeIcon,
  DatabricksIcon,
  LangfuseIcon,
  LangsmithIcon,
  MlflowIcon,
  OpikIcon,
  PhoenixIcon,
  TencentIcon,
  WeaveIcon,
} from '@/app/components/base/icons/src/public/tracing'
import Loading from '@/app/components/base/loading'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { usePathname } from '@/next/navigation'
import { updateTracingStatus } from '@/service/apps'
import { consoleQuery } from '@/service/client'
import { getAppACLCapabilities } from '@/utils/permission'
import ConfigButton from './config-button'
import TracingIcon from './tracing-icon'
import { isTracingProvider, TracingProvider } from './type'

const I18N_PREFIX = 'tracing'

const providerIconMap: Record<TracingProvider, React.FC<{ className?: string }>> = {
  [TracingProvider.arize]: ArizeIcon,
  [TracingProvider.phoenix]: PhoenixIcon,
  [TracingProvider.langSmith]: LangsmithIcon,
  [TracingProvider.langfuse]: LangfuseIcon,
  [TracingProvider.opik]: OpikIcon,
  [TracingProvider.weave]: WeaveIcon,
  [TracingProvider.aliyun]: AliyunIcon,
  [TracingProvider.mlflow]: MlflowIcon,
  [TracingProvider.databricks]: DatabricksIcon,
  [TracingProvider.tencent]: TencentIcon,
}

const Panel: FC = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const matched = /\/app\/([^/]+)/.exec(pathname)
  const appId = matched?.length && matched[1] ? matched[1] : ''
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const appDetail = useAppStore((state) => state.appDetail)
  const queryClient = useQueryClient()
  const appACLCapabilities = React.useMemo(
    () =>
      getAppACLCapabilities(appDetail?.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail?.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const readOnly = !appACLCapabilities.canConfigureTracing
  const summaryQueryOptions = consoleQuery.apps.byAppId.traceConfigs.get.queryOptions({
    input: {
      params: { app_id: appId },
      query: { include_config: false },
    },
  })
  const { data: tracingSummary, isPending, isError } = useQuery(summaryQueryOptions)
  const enabled = tracingSummary?.enabled ?? false
  const inUseTracingProvider = isTracingProvider(tracingSummary?.tracing_provider)
    ? tracingSummary.tracing_provider
    : null
  const hasConfiguredTracing = (tracingSummary?.configured_providers?.length ?? 0) > 0
  const InUseProviderIcon = inUseTracingProvider ? providerIconMap[inUseTracingProvider] : undefined

  const handleTracingStatusChange = async (tracingStatus: TracingStatus, noToast?: boolean) => {
    await updateTracingStatus({ appId, body: tracingStatus })
    queryClient.setQueryData(summaryQueryOptions.queryKey, (current) =>
      current ? { ...current, ...tracingStatus } : current,
    )
    if (!noToast) {
      toast(
        t(($) => $['api.success'], { ns: 'common' }),
        { type: 'success' },
      )
    }
  }

  const handleTracingEnabledChange = (nextEnabled: boolean) => {
    void handleTracingStatusChange({
      tracing_provider: inUseTracingProvider,
      enabled: nextEnabled,
    })
  }
  const handleChooseProvider = (provider: TracingProvider) => {
    void handleTracingStatusChange({
      tracing_provider: provider,
      enabled: true,
    })
  }
  const handleTracingConfigRemoved = (provider: TracingProvider) => {
    if (provider === inUseTracingProvider) {
      void handleTracingStatusChange(
        {
          enabled: false,
          tracing_provider: null,
        },
        true,
      )
    }
  }

  if (isPending) {
    return (
      <div className="mb-3 flex items-center justify-between">
        <div className="w-50">
          <Loading />
        </div>
      </div>
    )
  }
  if (isError && !tracingSummary) return null

  return (
    <div className={cn('flex items-center justify-between')}>
      <ConfigButton
        appId={appId}
        readOnly={readOnly}
        hasConfigured={hasConfiguredTracing}
        enabled={enabled}
        onStatusChange={handleTracingEnabledChange}
        chosenProvider={inUseTracingProvider}
        onChooseProvider={handleChooseProvider}
        onConfigRemoved={handleTracingConfigRemoved}
      >
        {!hasConfiguredTracing ? (
          <div className="flex cursor-pointer items-center rounded-xl border-[0.5px] border-components-panel-border bg-background-default-dodge p-2 shadow-xs select-none hover:bg-background-default-lighter">
            <TracingIcon size="md" />
            <div className="mx-2 system-sm-semibold text-text-secondary">
              {t(($) => $[`${I18N_PREFIX}.title`], { ns: 'app' })}
            </div>
            <div className="rounded-md p-1">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </div>
            <Divider type="vertical" className="h-3.5" />
            <div className="rounded-md p-1">
              <span className="i-ri-arrow-down-double-line size-4 text-text-tertiary" />
            </div>
          </div>
        ) : (
          <div className="flex cursor-pointer items-center rounded-xl border-[0.5px] border-components-panel-border bg-background-default-dodge p-2 shadow-xs select-none hover:bg-background-default-lighter">
            <div className="mr-1 ml-4 flex items-center">
              <StatusDot status={enabled ? 'success' : 'disabled'} />
              <div className="ml-1.5 system-xs-semibold-uppercase text-text-tertiary">
                {t(($) => $[`${I18N_PREFIX}.${enabled ? 'enabled' : 'disabled'}`], { ns: 'app' })}
              </div>
            </div>
            {InUseProviderIcon && <InUseProviderIcon className="ml-1 h-4" />}
            <div className="ml-2 rounded-md p-1">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </div>
            <Divider type="vertical" className="h-3.5" />
          </div>
        )}
      </ConfigButton>
    </div>
  )
}

export default React.memo(Panel)
