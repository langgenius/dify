import React from 'react'
import { CreateFromDSLModalTab } from '@/app/components/app/create-from-dsl-modal'
import { useTranslation } from 'react-i18next'
import Item from './item'

type TabProps = {
  currentTab: CreateFromDSLModalTab
  setCurrentTab: (tab: CreateFromDSLModalTab) => void
}

const Tab = ({
  currentTab,
  setCurrentTab,
}: TabProps) => {
  const { t } = useTranslation()

  const tabs = [
    {
      key: CreateFromDSLModalTab.FROM_FILE,
      label: t('app.importFromDSLFile'),
    },
    {
      key: CreateFromDSLModalTab.FROM_URL,
      label: t('app.importFromDSLUrl'),
    },
  ]

  return (
    <div className='system-md-semibold flex h-9 items-center gap-x-6 border-b border-divider-subtle px-6 text-text-tertiary'>
      {
        tabs.map(tab => (
          <Item
            key={tab.key}
            isActive={currentTab === tab.key}
            label={tab.label}
            onClick={setCurrentTab.bind(null, tab.key)}
          />
        ))
      }
    </div>
  )
}

export default Tab
