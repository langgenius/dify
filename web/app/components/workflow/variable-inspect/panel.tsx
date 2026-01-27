import type { FC } from 'react'
import {
  RiCloseLine,
} from '@remixicon/react'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import { cn } from '@/utils/classnames'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useStore } from '../store'
import { InspectTab } from './types'
import VariablesTab from './variables-tab'

const ArtifactsTab = lazy(() => import('./artifacts-tab'))

const TAB_ITEMS = [
  { value: InspectTab.Variables, labelKey: 'debug.variableInspect.tab.variables' },
  { value: InspectTab.Artifacts, labelKey: 'debug.variableInspect.tab.artifacts' },
] as const

const Panel: FC = () => {
  const { t } = useTranslation('workflow')
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)
  const [activeTab, setActiveTab] = useState<InspectTab>(InspectTab.Variables)

  const environmentVariables = useStore(s => s.environmentVariables)
  const { conversationVars, systemVars, nodesWithInspectVars, deleteAllInspectorVars } = useCurrentVars()

  const isVariablesEmpty = useMemo(() => {
    return [...environmentVariables, ...conversationVars, ...systemVars, ...nodesWithInspectVars].length === 0
  }, [environmentVariables, conversationVars, systemVars, nodesWithInspectVars])

  const handleClear = useCallback(() => {
    deleteAllInspectorVars()
    setCurrentFocusNodeId('')
  }, [deleteAllInspectorVars, setCurrentFocusNodeId])

  const handleClose = useCallback(() => {
    setShowVariableInspectPanel(false)
  }, [setShowVariableInspectPanel])

  return (
    <div className={cn('flex h-full flex-col')}>
      <div className="flex shrink-0 items-center justify-between gap-1 pl-3 pr-2 pt-2">
        <div className="flex items-center gap-0.5">
          {TAB_ITEMS.map(tab => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
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
          {activeTab === InspectTab.Variables && !isVariablesEmpty && (
            <Button variant="ghost" size="small" onClick={handleClear}>
              {t('debug.variableInspect.clearAll')}
            </Button>
          )}
        </div>
        <ActionButton onClick={handleClose}>
          <RiCloseLine className="h-4 w-4" />
        </ActionButton>
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === InspectTab.Variables && <VariablesTab />}
        {activeTab === InspectTab.Artifacts && (
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Loading /></div>}>
            <ArtifactsTab />
          </Suspense>
        )}
      </div>
    </div>
  )
}

export default Panel
