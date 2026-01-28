import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useStore } from '../store'
import ArtifactsTab from './artifacts-tab'
import { InspectTab } from './types'
import VariablesTab from './variables-tab'

const VariablesPanel: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('workflow')
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

  const headerActions = activeTab === InspectTab.Variables && !isVariablesEmpty
    ? (
        <Button variant="ghost" size="small" onClick={handleClear}>
          {t('debug.variableInspect.clearAll')}
        </Button>
      )
    : undefined

  const headerProps = {
    activeTab,
    onTabChange: setActiveTab,
    onClose,
    headerActions,
  }

  return activeTab === InspectTab.Variables
    ? <VariablesTab {...headerProps} />
    : <ArtifactsTab {...headerProps} />
}

const Panel: FC = () => {
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)

  const handleClose = useCallback(() => {
    setShowVariableInspectPanel(false)
  }, [setShowVariableInspectPanel])

  return <VariablesPanel onClose={handleClose} />
}

export default Panel
