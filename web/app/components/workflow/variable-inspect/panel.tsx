import type { ReactNode } from 'react'
import type { InspectTab as InspectTabType } from './types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useFeatures } from '@/app/components/base/features/hooks'
import Loading from '@/app/components/base/loading'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useStore } from '../store'
import ArtifactsEmptyState from './artifacts-empty-state'
import ArtifactsLeftPane from './artifacts-left-pane'
import ArtifactsRightPane from './artifacts-right-pane'
import Empty from './empty'
import {
  useArtifactsInspectView,
} from './hooks/use-artifacts-inspect-state'
import {
  useVariablesInspectView,
} from './hooks/use-variables-inspect-state'
import InspectScrollArea from './inspect-scroll-area'
import InspectShell from './inspect-shell'
import Left from './left'
import Listening from './listening'
import Right from './right'
import { InspectTab } from './types'

export default function Panel() {
  const { t } = useTranslation('workflow')
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const environmentVariables = useStore(s => s.environmentVariables)
  const sandboxEnabled = useFeatures(s => s.features.sandbox?.enabled) ?? false
  const [activeTab, setActiveTab] = useState<InspectTabType>(InspectTab.Variables)

  const {
    conversationVars,
    systemVars,
    nodesWithInspectVars,
    deleteAllInspectorVars,
  } = useCurrentVars()

  const variablesState = useVariablesInspectView()
  const artifactsState = useArtifactsInspectView()

  const resolvedTab = (!sandboxEnabled && activeTab === InspectTab.Artifacts)
    ? InspectTab.Variables
    : activeTab

  const isVariablesEmpty = useMemo(() => {
    return [...environmentVariables, ...conversationVars, ...systemVars, ...nodesWithInspectVars].length === 0
  }, [conversationVars, environmentVariables, nodesWithInspectVars, systemVars])

  const hasArtifacts = artifactsState.status === 'split'
  const hasData = !isVariablesEmpty || hasArtifacts

  const handleClear = useCallback(() => {
    deleteAllInspectorVars()
    setCurrentFocusNodeId('')
  }, [deleteAllInspectorVars, setCurrentFocusNodeId])

  const handleClose = useCallback(() => {
    setShowVariableInspectPanel(false)
  }, [setShowVariableInspectPanel])

  const headerActions = (
    <Button
      variant="ghost"
      size="small"
      onClick={handleClear}
      className={!hasData ? 'pointer-events-none invisible' : undefined}
      aria-hidden={!hasData}
      tabIndex={!hasData ? -1 : undefined}
    >
      {t('debug.variableInspect.clearAll')}
    </Button>
  )

  const headerProps = {
    activeTab: resolvedTab,
    headerActions,
    onClose: handleClose,
    onTabChange: setActiveTab,
  }

  let leftPane: ReactNode | undefined
  let body: ReactNode

  if (resolvedTab === InspectTab.Variables) {
    if (variablesState.status === 'listening') {
      body = (
        <div className="h-full p-2">
          <Listening onStop={variablesState.onStopListening} />
        </div>
      )
    }
    else if (variablesState.status === 'empty') {
      body = (
        <div className="h-full p-2">
          <Empty />
        </div>
      )
    }
    else {
      leftPane = (
        <InspectScrollArea>
          <Left
            currentNodeVar={variablesState.currentNodeVar}
            handleVarSelect={variablesState.onSelectVar}
          />
        </InspectScrollArea>
      )
      body = (
        <Right
          nodeId={variablesState.currentFocusNodeId || ''}
          currentNodeVar={variablesState.currentNodeVar}
          isValueFetching={variablesState.isValueFetching}
        />
      )
    }
  }
  else if (artifactsState.status === 'loading') {
    body = (
      <div className="flex h-full items-center justify-center">
        <Loading />
      </div>
    )
  }
  else if (artifactsState.status === 'empty') {
    body = (
      <div className="h-full p-2">
        <ArtifactsEmptyState description={t('debug.variableInspect.tabArtifacts.emptyTip')} />
      </div>
    )
  }
  else {
    leftPane = (
      <InspectScrollArea>
        <ArtifactsLeftPane
          treeData={artifactsState.treeData}
          handleTreeDownload={artifactsState.handleTreeDownload}
          handleFileSelect={artifactsState.handleFileSelect}
          selectedFilePath={artifactsState.selectedFilePath}
          isDownloading={artifactsState.isDownloading}
        />
      </InspectScrollArea>
    )
    body = (
      <ArtifactsRightPane
        downloadUrlData={artifactsState.downloadUrlData}
        handleSelectedFileDownload={artifactsState.handleSelectedFileDownload}
        isDownloadUrlLoading={artifactsState.isDownloadUrlLoading}
        pathSegments={artifactsState.pathSegments}
        selectedFile={artifactsState.selectedFile}
        selectedFilePath={artifactsState.selectedFilePath}
      />
    )
  }

  return (
    <InspectShell {...headerProps} left={leftPane}>
      {body}
    </InspectShell>
  )
}
