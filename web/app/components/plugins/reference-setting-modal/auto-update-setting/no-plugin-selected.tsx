'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AUTO_UPDATE_MODE } from './types'

type Props = {
  updateMode: AUTO_UPDATE_MODE
}

const NoPluginSelected: FC<Props> = ({
  updateMode,
}) => {
  const { t } = useTranslation()
  const text = `${t(`autoUpdate.upgradeModePlaceholder.${updateMode === AUTO_UPDATE_MODE.partial ? 'partial' : 'exclude'}`, { ns: 'plugin' })}`
  return (
    <div className="system-xs-regular rounded-[10px] border border-components-option-card-option-border bg-background-section p-3 text-center text-text-tertiary">
      {text}
    </div>
  )
}
export default React.memo(NoPluginSelected)
