'use client'

import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GroupName from '../base/group-name'
import Moderation from './moderation'

export type ToolboxProps = {
  showModerationSettings: boolean
}

const Toolbox: FC<ToolboxProps> = ({ showModerationSettings }) => {
  const { t } = useTranslation()

  return (
    <div className='mt-7'>
      <GroupName name={t('appDebug.feature.toolbox.title')} />
      {
        showModerationSettings && (
          <Moderation />
        )
      }
    </div>
  )
}
export default React.memo(Toolbox)
