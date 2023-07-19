'use client'
import type { FC } from 'react'
import React from 'react'
import ModelConfig from './model-config'
import DataConfig from './data-config'
import PluginConfig from './plugins-config'

export type IConfigProps = {
  className?: string
  readonly?: boolean
  modelId: string
  onModelChange: (modelId: string) => void
  plugins: Record<string, boolean>
  onPluginChange: (key: string, value: boolean) => void
  dataSets: any[]
  onDataSetsChange: (contexts: any[]) => void
}

const Config: FC<IConfigProps> = ({
  className,
  readonly,
  modelId,
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
        onChange={onModelChange}
      />
      <PluginConfig
        config={plugins}
        onChange={onPluginChange}
      />
      <DataConfig
        dataSets={dataSets}
        onChange={onDataSetsChange}
      />
    </div>
  )
}
export default React.memo(Config)
