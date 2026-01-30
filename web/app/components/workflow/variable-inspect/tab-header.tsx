import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures } from '@/app/components/base/features/hooks'
import { cn } from '@/utils/classnames'
import { InspectTab } from './types'

const TAB_ITEMS = [
  { value: InspectTab.Variables, labelKey: 'debug.variableInspect.tab.variables' as const },
  { value: InspectTab.Artifacts, labelKey: 'debug.variableInspect.tab.artifacts' as const, sandboxOnly: true as const },
]

type TabHeaderProps = {
  activeTab: InspectTab
  onTabChange: (tab: InspectTab) => void
  children?: ReactNode
}

const TabHeader: FC<TabHeaderProps> = ({
  activeTab,
  onTabChange,
  children,
}) => {
  const { t } = useTranslation('workflow')
  const sandboxEnabled = useFeatures(s => s.features.sandbox?.enabled) ?? false

  const visibleTabs = useMemo(
    () => TAB_ITEMS.filter(tab => !tab.sandboxOnly || sandboxEnabled),
    [sandboxEnabled],
  )

  return (
    <div className="flex h-10 w-full shrink-0 items-center gap-0.5 pl-3 pr-2">
      {visibleTabs.map(tab => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onTabChange(tab.value)}
          className={cn(
            'system-sm-semibold rounded-md px-2 py-1 transition-colors',
            activeTab === tab.value
              ? 'bg-state-base-active text-text-primary'
              : 'text-text-tertiary hover:text-text-secondary',
          )}
        >
          {t(tab.labelKey)}
        </button>
      ))}
      <div className="ml-auto">{children}</div>
    </div>
  )
}

export default TabHeader
