import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useFeatures } from '@/app/components/base/features/hooks'
import { useSandboxFilesTree } from '@/service/use-sandbox-file'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useStore } from '../store'
import ArtifactsTab from './artifacts-tab'
import { InspectTab } from './types'
import VariablesTab from './variables-tab'

const VariablesPanel: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('workflow')
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)
  const appId = useStore(s => s.appId)
  const sandboxEnabled = useFeatures(s => s.features.sandbox?.enabled) ?? false
  const [activeTab, setActiveTab] = useState<InspectTab>(InspectTab.Variables)

  const resolvedTab = (!sandboxEnabled && activeTab === InspectTab.Artifacts)
    ? InspectTab.Variables
    : activeTab

  const environmentVariables = useStore(s => s.environmentVariables)
  const { conversationVars, systemVars, nodesWithInspectVars, deleteAllInspectorVars } = useCurrentVars()

  const isVariablesEmpty = useMemo(() => {
    return [...environmentVariables, ...conversationVars, ...systemVars, ...nodesWithInspectVars].length === 0
  }, [environmentVariables, conversationVars, systemVars, nodesWithInspectVars])

  const { hasFiles: hasArtifacts } = useSandboxFilesTree(appId, {
    enabled: !!appId && sandboxEnabled,
  })

  const handleClear = useCallback(() => {
    deleteAllInspectorVars()
    setCurrentFocusNodeId('')
  }, [deleteAllInspectorVars, setCurrentFocusNodeId])

  const hasData = resolvedTab === InspectTab.Variables ? !isVariablesEmpty : hasArtifacts
  const headerActions = hasData
    ? (
        <Button variant="ghost" size="small" onClick={handleClear}>
          {t('debug.variableInspect.clearAll')}
        </Button>
      )
    : undefined

  const headerProps = {
    activeTab: resolvedTab,
    onTabChange: setActiveTab,
    onClose,
    headerActions,
  }

  return resolvedTab === InspectTab.Variables
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
