'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiEqualizer2Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TracingProvider } from './type'

const I18N_PREFIX = 'tracing'

type Props = Readonly<{
  type: TracingProvider
  readOnly: boolean
  isChosen: boolean
  config: any
  onChoose: () => void
  hasConfigured: boolean
  onConfig: () => void
}>

const getIconClassName = (type: TracingProvider) => {
  return {
    [TracingProvider.arize]: 'i-custom-public-tracing-arize-icon-big w-27.75',
    [TracingProvider.phoenix]: 'i-custom-public-tracing-phoenix-icon-big w-27.75',
    [TracingProvider.langSmith]: 'i-custom-public-tracing-langsmith-icon-big w-31',
    [TracingProvider.langfuse]: 'i-custom-public-tracing-langfuse-icon-big w-27.75',
    [TracingProvider.opik]: 'i-custom-public-tracing-opik-icon-big w-[70.700851px]',
    [TracingProvider.weave]: 'i-custom-public-tracing-weave-icon-big w-31',
    [TracingProvider.aliyun]: 'i-custom-public-tracing-aliyun-icon-big w-24',
    [TracingProvider.mlflow]: 'i-custom-public-tracing-mlflow-icon-big w-16.25',
    [TracingProvider.databricks]: 'i-custom-public-tracing-databricks-icon-big w-37.5',
    [TracingProvider.tencent]: 'i-custom-public-tracing-tencent-icon-big w-30',
  }[type]
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
  const iconClassName = getIconClassName(type)

  const handleConfigBtnClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onConfig()
    },
    [onConfig],
  )

  const viewBtnClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const url = config?.project_url
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    },
    [config?.project_url],
  )

  const handleChosen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isChosen || !hasConfigured || readOnly) return
      onChoose()
    },
    [hasConfigured, isChosen, onChoose, readOnly],
  )
  return (
    <div
      className={cn(
        'rounded-xl border-[1.5px] bg-background-section-burn px-4 py-3',
        isChosen
          ? 'border-components-option-card-option-selected-border bg-background-section'
          : 'border-transparent',
        !isChosen && hasConfigured && !readOnly && 'cursor-pointer',
      )}
      onClick={handleChosen}
    >
      <div className="flex items-center justify-between space-x-1">
        <div className="flex items-center">
          <span aria-hidden className={cn(iconClassName, 'h-6')} />
          {isChosen && (
            <div className="ml-1 flex h-4 items-center rounded-sm border border-text-accent-secondary px-1 system-2xs-medium-uppercase text-text-accent-secondary">
              {t(($) => $[`${I18N_PREFIX}.inUse`], { ns: 'app' })}
            </div>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center justify-between space-x-1">
            {hasConfigured && (
              <div
                className="flex h-6 cursor-pointer items-center space-x-1 rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-text-secondary shadow-xs"
                onClick={viewBtnClick}
              >
                <span aria-hidden className="i-custom-vender-solid-general-eye size-3" />
                <div className="text-xs font-medium">
                  {t(($) => $[`${I18N_PREFIX}.view`], { ns: 'app' })}
                </div>
              </div>
            )}
            <div
              className="flex h-6 cursor-pointer items-center space-x-1 rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-text-secondary shadow-xs"
              onClick={handleConfigBtnClick}
            >
              <RiEqualizer2Line className="size-3" />
              <div className="text-xs font-medium">
                {t(($) => $[`${I18N_PREFIX}.config`], { ns: 'app' })}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 system-xs-regular text-text-tertiary">
        {t(($) => $[`${I18N_PREFIX}.${type}.description`], { ns: 'app' })}
      </div>
    </div>
  )
}
export default React.memo(ProviderPanel)
