'use client'

import type { FC } from 'react'
import React from 'react'
import GroupName from '../base/group-name'
import Moderation from './moderation'

export type ToolboxProps = {
  showModerationSettings: boolean
}

const Toolbox: FC<ToolboxProps> = ({ showModerationSettings }) => {
  return (
    <div className='mt-7'>
      <GroupName name='Toolbox' />
      {
        showModerationSettings && (
          <Moderation />
        )
      }
    </div>
  )
}
export default React.memo(Toolbox)
