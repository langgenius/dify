import type { FC } from 'react'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useStore } from '../store'
import InspectLayout from './inspect-layout'
import { InspectTab } from './types'
import VariablesTab from './variables-tab'

const ArtifactsTab = lazy(() => import('./artifacts-tab'))

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

  const headerActions = activeTab === InspectTab.Variables && !isVariablesEmpty
    ? (
        <Button variant="ghost" size="small" onClick={handleClear}>
          {t('debug.variableInspect.clearAll')}
        </Button>
      )
    : undefined

  return (
    <InspectLayout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onClose={handleClose}
      headerActions={headerActions}
    >
      {activeTab === InspectTab.Variables && <VariablesTab />}
      {activeTab === InspectTab.Artifacts && (
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loading /></div>}>
          <ArtifactsTab />
        </Suspense>
      )}
    </InspectLayout>
  )
}

export default Panel
