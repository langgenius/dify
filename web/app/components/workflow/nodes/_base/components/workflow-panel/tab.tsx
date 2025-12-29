'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import TabHeader from '@/app/components/base/tab-header'

export enum TabType {
  settings = 'settings',
  lastRun = 'lastRun',
  relations = 'relations',
}

type Props = {
  value: TabType
  onChange: (value: TabType) => void
}

const Tab: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  return (
    <TabHeader
      items={[
        { id: TabType.settings, name: t('debug.settingsTab', { ns: 'workflow' }).toLocaleUpperCase() },
        { id: TabType.lastRun, name: t('debug.lastRunTab', { ns: 'workflow' }).toLocaleUpperCase() },
      ]}
      itemClassName="ml-0"
      value={value}
      onChange={onChange as any}
    />
  )
}
export default React.memo(Tab)
