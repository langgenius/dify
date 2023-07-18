'use client'
import type { FC } from 'react'
import React from 'react'
import DataConfig from './data-config'
import PluginConfig from './plug-config'

export type IConfigProps = {
  className?: string
  plugins: Record<string, boolean>
  onPluginChange: (key: string, value: boolean) => void
  dataSets: any[]
  onDataSetsChange: (contexts: any[]) => void
}

const Config: FC<IConfigProps> = ({
  className,
  plugins,
  onPluginChange,
  dataSets,
  onDataSetsChange,
}) => {
  return (
    <div className={className}>
      <div >

      </div>
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
