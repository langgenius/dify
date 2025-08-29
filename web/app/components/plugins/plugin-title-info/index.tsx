'use client'
import React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiBugLine,
  RiHardDrive3Line,
  RiVerifiedBadgeLine,
} from '@remixicon/react'
import { BoxSparkleFill } from '@/app/components/base/icons/src/vender/plugin'
import { Github } from '@/app/components/base/icons/src/public/common'
import Tooltip from '@/app/components/base/tooltip'
import Badge from '@/app/components/base/badge'
import { API_PREFIX } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import type { PluginDetail } from '@/app/components/plugins/types'
import { PluginSource } from '@/app/components/plugins/types'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import Icon from '@/app/components/plugins/card/base/card-icon'
import type { TypeWithI18N } from '../../base/form/types'

type PluginInfoProps = {
  detail: PluginDetail & { icon?: string, label?: TypeWithI18N<string>, author?: string, name?: string, verified?: boolean }
  size?: 'default' | 'large'
}

const PluginInfo: FC<PluginInfoProps> = ({
  detail,
  size = 'default',
}) => {
  const { t } = useTranslation()
  const { currentWorkspace } = useAppContext()
  const locale = useLanguage()

  const tenant_id = currentWorkspace?.id
  const {
    version,
    source,
  } = detail

  const icon = detail.declaration?.icon || detail?.icon
  const label = detail.declaration?.label || detail?.label
  const author = detail.declaration?.author || detail?.author
  const name = detail.declaration?.name || detail?.name
  const verified = detail.declaration?.verified || detail?.verified

  const isLarge = size === 'large'
  const iconSize = isLarge ? 'h-10 w-10' : 'h-8 w-8'
  const titleSize = isLarge ? 'text-sm' : 'text-xs'

  return (
    <div className={`flex items-center ${isLarge ? 'gap-3' : 'gap-2'}`}>
      {/* Plugin Icon */}
      <div className={`shrink-0 overflow-hidden rounded-lg border border-components-panel-border-subtle ${iconSize}`}>
        <Icon src={icon?.startsWith('http') ? icon : `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=${tenant_id}&filename=${icon}`} />
      </div>

      {/* Plugin Details */}
      <div className="min-w-0 flex-1">
        {/* Name and Version */}
        <div className="mb-0.5 flex items-center gap-1">
          <h3 className={`truncate font-semibold text-text-secondary ${titleSize}`}>
            {label?.[locale]}
          </h3>
          {verified && <RiVerifiedBadgeLine className="h-3 w-3 shrink-0 text-text-accent" />}
          <Badge
            className="mx-1"
            uppercase={false}
            text={version}
          />
        </div>

        {/* Organization and Source */}
        <div className="flex items-center text-xs">
          <OrgInfo
            packageNameClassName="w-auto"
            orgName={author}
            packageName={name}
          />
          <div className="ml-1 mr-0.5 text-text-quaternary">·</div>

          {/* Source Icon */}
          {source === PluginSource.marketplace && (
            <Tooltip popupContent={t('plugin.detailPanel.categoryTip.marketplace')}>
              <div>
                <BoxSparkleFill className="h-3.5 w-3.5 text-text-tertiary hover:text-text-accent" />
              </div>
            </Tooltip>
          )}
          {source === PluginSource.github && (
            <Tooltip popupContent={t('plugin.detailPanel.categoryTip.github')}>
              <div>
                <Github className="h-3.5 w-3.5 text-text-secondary hover:text-text-primary" />
              </div>
            </Tooltip>
          )}
          {source === PluginSource.local && (
            <Tooltip popupContent={t('plugin.detailPanel.categoryTip.local')}>
              <div>
                <RiHardDrive3Line className="h-3.5 w-3.5 text-text-tertiary" />
              </div>
            </Tooltip>
          )}
          {source === PluginSource.debugging && (
            <Tooltip popupContent={t('plugin.detailPanel.categoryTip.debugging')}>
              <div>
                <RiBugLine className="h-3.5 w-3.5 text-text-tertiary hover:text-text-warning" />
              </div>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

export default PluginInfo
