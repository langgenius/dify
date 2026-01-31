'use client'
import type { FC } from 'react'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AliyunIconBig, ArizeIconBig, DatabricksIconBig, LangfuseIconBig, LangsmithIconBig, MlflowIconBig, OpikIconBig, PhoenixIconBig, TencentIconBig, WeaveIconBig } from '@/app/components/base/icons/src/public/tracing'
import { Eye as View } from '@/app/components/base/icons/src/vender/solid/general'
import { cn } from '@/utils/classnames'
import { TracingProvider } from './type'

const I18N_PREFIX = 'tracing'

type Props = {
  type: TracingProvider
  readOnly: boolean
  isChosen: boolean
  config: any
  onChoose: () => void
  hasConfigured: boolean
  onConfig: () => void
}

const getIcon = (type: TracingProvider) => {
  return ({
    [TracingProvider.arize]: ArizeIconBig,
    [TracingProvider.phoenix]: PhoenixIconBig,
    [TracingProvider.langSmith]: LangsmithIconBig,
    [TracingProvider.langfuse]: LangfuseIconBig,
    [TracingProvider.opik]: OpikIconBig,
    [TracingProvider.weave]: WeaveIconBig,
    [TracingProvider.aliyun]: AliyunIconBig,
    [TracingProvider.mlflow]: MlflowIconBig,
    [TracingProvider.databricks]: DatabricksIconBig,
    [TracingProvider.tencent]: TencentIconBig,
  })[type]
}

const ProviderPanel: FC<Props> = ({
  type,
  readOnly,
  isChosen,
  config,
  onChoose,
  hasConfigured,
  onConfig,
}) => {
  const { t } = useTranslation()
  const Icon = getIcon(type)

  const handleConfigBtnClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onConfig()
  }, [onConfig])

  const viewBtnClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const url = config?.project_url
    if (url)
      window.open(url, '_blank', 'noopener,noreferrer')
  }, [config?.project_url])

  const handleChosen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isChosen || !hasConfigured || readOnly)
      return
    onChoose()
  }, [hasConfigured, isChosen, onChoose, readOnly])
  return (
    <div
      className={cn(
        'rounded-xl border-[1.5px] bg-background-section-burn px-4 py-3',
        isChosen ? 'border-components-option-card-option-selected-border bg-background-section' : 'border-transparent',
        !isChosen && hasConfigured && !readOnly && 'cursor-pointer',
      )}
      onClick={handleChosen}
    >
      <div className="flex items-center justify-between space-x-1">
        <div className="flex items-center">
          <Icon className="h-6" />
          {isChosen && <div className="system-2xs-medium-uppercase ml-1 flex h-4 items-center rounded-[4px] border border-text-accent-secondary px-1 text-text-accent-secondary">{t(`${I18N_PREFIX}.inUse`, { ns: 'app' })}</div>}
        </div>
        {!readOnly && (
          <div className="flex items-center justify-between space-x-1">
            {hasConfigured && (
              <div className="flex h-6 cursor-pointer items-center space-x-1 rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-text-secondary shadow-xs" onClick={viewBtnClick}>
                <View className="h-3 w-3" />
                <div className="text-xs font-medium">{t(`${I18N_PREFIX}.view`, { ns: 'app' })}</div>
              </div>
            )}
            <div
              className="flex h-6 cursor-pointer items-center space-x-1 rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-text-secondary shadow-xs"
              onClick={handleConfigBtnClick}
            >
              <RiEqualizer2Line className="h-3 w-3" />
              <div className="text-xs font-medium">{t(`${I18N_PREFIX}.config`, { ns: 'app' })}</div>
            </div>
          </div>
        )}
      </div>
      <div className="system-xs-regular mt-2 text-text-tertiary">
        {t(`${I18N_PREFIX}.${type}.description`, { ns: 'app' })}
      </div>
    </div>
  )
}
export default React.memo(ProviderPanel)
