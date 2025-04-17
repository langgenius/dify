'use client'
import TabHeader from '@/app/components/base/tab-header'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

export enum TabType {
  settings = 'settings',
  lastRun = 'lastRun',
}

type Props = {
  value: TabType,
  onChange: (value: TabType) => void
  canSwitchToLastRun: boolean
}

const Tab: FC<Props> = ({
  value,
  onChange,
  canSwitchToLastRun,
}) => {
  const { t } = useTranslation()
  return (
    <TabHeader
      items={[
        { id: TabType.settings, name: t('workflow.debug.settingsTab').toLocaleUpperCase() },
        { id: TabType.lastRun, name: t('workflow.debug.lastRunTab').toLocaleUpperCase(), disabled: !canSwitchToLastRun },
      ]}
      itemClassName='ml-0'
      value={value}
      onChange={onChange as any}
    />
  )
}
export default React.memo(Tab)
