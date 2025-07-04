'use client'
import type { FC } from 'react'
import React from 'react'
import { AUTO_UPDATE_MODE } from './types'
import { useTranslation } from 'react-i18next'

type Props = {
  updateMode: AUTO_UPDATE_MODE
}

const NoPluginSelected: FC<Props> = ({
  updateMode,
}) => {
  const { t } = useTranslation()
  const text = `${t(`plugin.autoUpdate.upgradeModePlaceholder.${updateMode === AUTO_UPDATE_MODE.partial ? 'partial' : 'exclude'}`)}`
  return (
    <div className='system-xs-regular rounded-[10px] border border-[divider-subtle] bg-background-section p-3 text-center text-text-tertiary'>
      {text}
    </div>
  )
}
export default React.memo(NoPluginSelected)
