'use client'

import type { FC, ReactNode } from 'react'
import {
  RiBugLine,
  RiHardDrive3Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { Github } from '@/app/components/base/icons/src/public/common'
import { BoxSparkleFill } from '@/app/components/base/icons/src/vender/plugin'
import Tooltip from '@/app/components/base/tooltip'
import { PluginSource } from '../../../types'

type SourceConfig = {
  icon: ReactNode
  tipKey: string
}

type PluginSourceBadgeProps = {
  source: PluginSource
}

const SOURCE_CONFIG_MAP: Record<PluginSource, SourceConfig | null> = {
  [PluginSource.marketplace]: {
    icon: <BoxSparkleFill className="h-3.5 w-3.5 text-text-tertiary hover:text-text-accent" />,
    tipKey: 'detailPanel.categoryTip.marketplace',
  },
  [PluginSource.github]: {
    icon: <Github className="h-3.5 w-3.5 text-text-secondary hover:text-text-primary" />,
    tipKey: 'detailPanel.categoryTip.github',
  },
  [PluginSource.local]: {
    icon: <RiHardDrive3Line className="h-3.5 w-3.5 text-text-tertiary" />,
    tipKey: 'detailPanel.categoryTip.local',
  },
  [PluginSource.debugging]: {
    icon: <RiBugLine className="h-3.5 w-3.5 text-text-tertiary hover:text-text-warning" />,
    tipKey: 'detailPanel.categoryTip.debugging',
  },
}

const PluginSourceBadge: FC<PluginSourceBadgeProps> = ({ source }) => {
  const { t } = useTranslation()

  const config = SOURCE_CONFIG_MAP[source]
  if (!config)
    return null

  return (
    <>
      <div className="system-xs-regular ml-1 mr-0.5 text-text-quaternary">·</div>
      <Tooltip popupContent={t(config.tipKey as never, { ns: 'plugin' })}>
        <div>{config.icon}</div>
      </Tooltip>
    </>
  )
}

export default PluginSourceBadge
