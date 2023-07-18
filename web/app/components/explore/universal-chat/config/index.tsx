'use client'
import type { FC } from 'react'
import React from 'react'

export type IConfigProps = {
  className?: string
  plugins: Record<string, boolean>
  onPluginChange: (key: string, value: boolean) => void
  contexts: any[]
  onContextChange: (contexts: any[]) => void
}

const Config: FC<IConfigProps> = ({
  className,
  plugins,
  onPluginChange,
  contexts,
  onContextChange,
}) => {
  return (
    <div className={className}>
      Config content
    </div>
  )
}
export default React.memo(Config)
