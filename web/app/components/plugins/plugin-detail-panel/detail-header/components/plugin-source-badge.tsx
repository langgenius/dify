'use client'

import type { FC, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiBugLine,
  RiHardDrive3Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { Github } from '@/app/components/base/icons/src/public/common'
import { BoxSparkleFill } from '@/app/components/base/icons/src/vender/plugin'
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
  const tip = t(config.tipKey as never, { ns: 'plugin' })

  return (
    <>
      <div className="mr-0.5 ml-1 system-xs-regular text-text-quaternary">·</div>
      <Tooltip>
        <TooltipTrigger
          render={(
            <span aria-label={tip} className="inline-flex">
              {config.icon}
            </span>
          )}
        />
        <TooltipContent>
          {tip}
        </TooltipContent>
      </Tooltip>
    </>
  )
}

export default PluginSourceBadge
