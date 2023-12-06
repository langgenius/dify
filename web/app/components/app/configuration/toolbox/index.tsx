'use client'

import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GroupName from '../base/group-name'
import Moderation from './moderation'
import Annotation from './annotation'

export type ToolboxProps = {
  showModerationSettings: boolean
  showAnnotation: boolean
}

const Toolbox: FC<ToolboxProps> = ({ showModerationSettings, showAnnotation }) => {
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
        showAnnotation && (
          <Annotation />
        )
      }
    </div>
  )
}
export default React.memo(Toolbox)
