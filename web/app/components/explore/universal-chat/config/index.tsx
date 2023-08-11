'use client'
import type { FC } from 'react'
import React from 'react'
import ModelConfig from './model-config'
import DataConfig from './data-config'
import PluginConfig from './plugins-config'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'

export type IConfigProps = {
  className?: string
  readonly?: boolean
  modelId: string
  providerName: ProviderEnum
  onModelChange?: (modelId: string, providerName: ProviderEnum) => void
  plugins: Record<string, boolean>
  onPluginChange?: (key: string, value: boolean) => void
  dataSets: any[]
  onDataSetsChange?: (contexts: any[]) => void
}

const Config: FC<IConfigProps> = ({
  className,
  readonly,
  modelId,
  providerName,
  onModelChange,
  plugins,
  onPluginChange,
  dataSets,
  onDataSetsChange,
}) => {
  return (
    <div className={className}>
      <ModelConfig
        readonly={readonly}
        modelId={modelId}
        providerName={providerName}
        onChange={onModelChange}
      />
      <PluginConfig
        readonly={readonly}
        config={plugins}
        onChange={onPluginChange}
      />
      {(!readonly || (readonly && dataSets.length > 0)) && (
        <DataConfig
          readonly={readonly}
          dataSets={dataSets}
          onChange={onDataSetsChange}
        />
      )}
    </div>
  )
}
export default React.memo(Config)
