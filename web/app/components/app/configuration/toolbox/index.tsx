'use client'

import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GroupName from '../base/group-name'
import Moderation from './moderation'
import CacheReply from './cache-reply'

export type ToolboxProps = {
  showModerationSettings: boolean
  showCacheReply: boolean
}

const Toolbox: FC<ToolboxProps> = ({ showModerationSettings, showCacheReply }) => {
  const { t } = useTranslation()

  return (
    <div className='mt-7'>
      <GroupName name={t('appDebug.feature.toolbox.title')} />
      {
        showModerationSettings && (
          <Moderation />
        )
      }
      {
        showCacheReply && (
          <CacheReply />
        )
      }
    </div>
  )
}
export default React.memo(Toolbox)
