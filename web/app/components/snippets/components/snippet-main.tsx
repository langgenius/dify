'use client'

import type { NavIcon } from '@/app/components/app-sidebar/nav-link'
import type { WorkflowProps } from '@/app/components/workflow'
import type { SnippetDetailPayload, SnippetSection } from '@/models/snippet'
import {
  RiFlaskFill,
  RiFlaskLine,
  RiTerminalWindowFill,
  RiTerminalWindowLine,
} from '@remixicon/react'
import {
  useEffect,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import AppSideBar from '@/app/components/app-sidebar'
import NavLink from '@/app/components/app-sidebar/nav-link'
import SnippetInfo from '@/app/components/app-sidebar/snippet-info'
import { useStore as useAppStore } from '@/app/components/app/store'
import Evaluation from '@/app/components/evaluation'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useAvailableNodesMetaData } from '@/app/components/workflow-app/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useNodesSyncDraft } from '../hooks/use-nodes-sync-draft'
import { useSnippetRefreshDraft } from '../hooks/use-snippet-refresh-draft'
import { useSnippetDetailStore } from '../store'
import { useSnippetInputFieldActions } from './hooks/use-snippet-input-field-actions'
import { useSnippetPublish } from './hooks/use-snippet-publish'
import SnippetChildren from './snippet-children'

type SnippetMainProps = {
  payload: SnippetDetailPayload
  snippetId: string
  section: SnippetSection
} & Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>

const ORCHESTRATE_ICONS: { normal: NavIcon, selected: NavIcon } = {
  normal: RiTerminalWindowLine,
  selected: RiTerminalWindowFill,
}

const EVALUATION_ICONS: { normal: NavIcon, selected: NavIcon } = {
  normal: RiFlaskLine,
  selected: RiFlaskFill,
}

const SnippetMain = ({
  payload,
  snippetId,
  section,
  nodes,
  edges,
  viewport,
}: SnippetMainProps) => {
  const { t } = useTranslation('snippet')
  const { graph, snippet, uiMeta } = payload
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  } = useNodesSyncDraft(snippetId)
  const { handleRefreshWorkflowDraft } = useSnippetRefreshDraft(snippetId)
  const configsMap = useConfigsMap(snippetId)
  const workflowAvailableNodesMetaData = useAvailableNodesMetaData()
  const availableNodesMetaData = useMemo(() => {
    const nodes = workflowAvailableNodesMetaData.nodes.filter(node =>
      node.metaData.type !== BlockEnum.HumanInput && node.metaData.type !== BlockEnum.End)

    if (!workflowAvailableNodesMetaData.nodesMap)
      return { nodes }

    const {
      [BlockEnum.HumanInput]: _humanInput,
      [BlockEnum.End]: _end,
      ...nodesMap
    } = workflowAvailableNodesMetaData.nodesMap

    return {
      nodes,
      nodesMap,
    }
  }, [workflowAvailableNodesMetaData])
  const setAppSidebarExpand = useAppStore(state => state.setAppSidebarExpand)
  const reset = useSnippetDetailStore(state => state.reset)
  const {
    editingField,
    fields,
    isEditorOpen,
    isInputPanelOpen,
    openEditor,
    closeEditor,
    handleCloseInputPanel,
    handleRemoveField,
    handleSortChange,
    handleSubmitField,
    handleToggleInputPanel,
  } = useSnippetInputFieldActions({
    snippetId,
    initialFields: payload.inputFields,
  })
  const {
    handlePublish,
    isPublishMenuOpen,
    isPublishing,
    setPublishMenuOpen,
  } = useSnippetPublish({
    snippetId,
    section,
  })

  useEffect(() => {
    reset()
  }, [reset, snippetId])

  useEffect(() => {
    const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
    const mode = isMobile ? 'collapse' : 'expand'
    setAppSidebarExpand(isMobile ? mode : localeMode)
  }, [isMobile, setAppSidebarExpand])

  const hooksStore = useMemo(() => {
    return {
      doSyncWorkflowDraft,
      syncWorkflowDraftWhenPageClose,
      handleRefreshWorkflowDraft,
      availableNodesMetaData,
      configsMap,
    }
  }, [availableNodesMetaData, configsMap, doSyncWorkflowDraft, handleRefreshWorkflowDraft, syncWorkflowDraftWhenPageClose])

  return (
    <div className="relative flex h-full overflow-hidden bg-background-body">
      <AppSideBar
        navigation={[]}
        renderHeader={mode => <SnippetInfo expand={mode === 'expand'} snippet={snippet} />}
        renderNavigation={mode => (
          <>
            <NavLink
              mode={mode}
              name={t('sectionOrchestrate')}
              iconMap={ORCHESTRATE_ICONS}
              href={`/snippets/${snippetId}/orchestrate`}
              active={section === 'orchestrate'}
            />
            <NavLink
              mode={mode}
              name={t('sectionEvaluation')}
              iconMap={EVALUATION_ICONS}
              href={`/snippets/${snippetId}/evaluation`}
              active={section === 'evaluation'}
            />
          </>
        )}
      />

      <div className="relative min-h-0 min-w-0 grow overflow-hidden">
        <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
          {section === 'evaluation'
            ? (
                <Evaluation resourceType="snippet" resourceId={snippetId} />
              )
            : (
                <WorkflowWithInnerContext
                  nodes={nodes}
                  edges={edges}
                  viewport={viewport ?? graph.viewport}
                  hooksStore={hooksStore as any}
                >
                  <SnippetChildren
                    snippetId={snippetId}
                    fields={fields}
                    uiMeta={uiMeta}
                    editingField={editingField}
                    isEditorOpen={isEditorOpen}
                    isInputPanelOpen={isInputPanelOpen}
                    isPublishMenuOpen={isPublishMenuOpen}
                    isPublishing={isPublishing}
                    onToggleInputPanel={handleToggleInputPanel}
                    onPublishMenuOpenChange={setPublishMenuOpen}
                    onCloseInputPanel={handleCloseInputPanel}
                    onPublish={handlePublish}
                    onOpenEditor={openEditor}
                    onCloseEditor={closeEditor}
                    onSubmitField={handleSubmitField}
                    onRemoveField={handleRemoveField}
                    onSortChange={handleSortChange}
                  />
                </WorkflowWithInnerContext>
              )}
        </div>
      </div>
    </div>
  )
}

export default SnippetMain
