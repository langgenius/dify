'use client'

import type { NavIcon } from '@/app/components/app-sidebar/nav-link'
import type { WorkflowProps } from '@/app/components/workflow'
import type { SnippetDetailPayload, SnippetInputField, SnippetSection } from '@/models/snippet'
import {
  RiFlaskFill,
  RiFlaskLine,
  RiTerminalWindowFill,
  RiTerminalWindowLine,
} from '@remixicon/react'
import {
  useKeyPress,
} from 'ahooks'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import AppSideBar from '@/app/components/app-sidebar'
import NavLink from '@/app/components/app-sidebar/nav-link'
import SnippetInfo from '@/app/components/app-sidebar/snippet-info'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import Evaluation from '@/app/components/evaluation'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import { useAvailableNodesMetaData } from '@/app/components/workflow-app/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { usePublishSnippetWorkflowMutation } from '@/service/use-snippet-workflows'
import { useConfigsMap } from '../hooks/use-configs-map'
import { useNodesSyncDraft } from '../hooks/use-nodes-sync-draft'
import { useSnippetRefreshDraft } from '../hooks/use-snippet-refresh-draft'
import { useSnippetDetailStore } from '../store'
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
  const [fields, setFields] = useState<SnippetInputField[]>(payload.inputFields)
  const publishSnippetMutation = usePublishSnippetWorkflowMutation(snippetId)
  const {
    doSyncWorkflowDraft,
    syncInputFieldsDraft,
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
  const {
    editingField,
    isEditorOpen,
    isInputPanelOpen,
    isPublishMenuOpen,
    closeEditor,
    openEditor,
    reset,
    setInputPanelOpen,
    setPublishMenuOpen,
    toggleInputPanel,
  } = useSnippetDetailStore(useShallow(state => ({
    editingField: state.editingField,
    isEditorOpen: state.isEditorOpen,
    isInputPanelOpen: state.isInputPanelOpen,
    isPublishMenuOpen: state.isPublishMenuOpen,
    closeEditor: state.closeEditor,
    openEditor: state.openEditor,
    reset: state.reset,
    setInputPanelOpen: state.setInputPanelOpen,
    setPublishMenuOpen: state.setPublishMenuOpen,
    toggleInputPanel: state.toggleInputPanel,
  })))

  useEffect(() => {
    reset()
  }, [reset, snippetId])

  useEffect(() => {
    const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
    const mode = isMobile ? 'collapse' : 'expand'
    setAppSidebarExpand(isMobile ? mode : localeMode)
  }, [isMobile, setAppSidebarExpand])

  const handleSortChange = (newFields: SnippetInputField[]) => {
    setFields(newFields)
  }

  const handleRemoveField = (index: number) => {
    const nextFields = fields.filter((_, currentIndex) => currentIndex !== index)
    setFields(nextFields)
    void syncInputFieldsDraft(nextFields, {
      onRefresh: setFields,
    })
  }

  const handleSubmitField = (field: SnippetInputField) => {
    const originalVariable = editingField?.variable
    const duplicated = fields.some(item => item.variable === field.variable && item.variable !== originalVariable)

    if (duplicated) {
      toast.error(t('inputFieldPanel.error.variableDuplicate', { ns: 'datasetPipeline' }))
      return
    }

    const nextFields = originalVariable
      ? fields.map(item => item.variable === originalVariable ? field : item)
      : [...fields, field]

    setFields(nextFields)
    void syncInputFieldsDraft(nextFields, {
      onRefresh: setFields,
    })

    closeEditor()
  }

  const handleToggleInputPanel = () => {
    if (isInputPanelOpen)
      closeEditor()
    toggleInputPanel()
  }

  const handleCloseInputPanel = () => {
    closeEditor()
    setInputPanelOpen(false)
  }

  const handlePublish = useCallback(async () => {
    try {
      await publishSnippetMutation.mutateAsync({
        params: { snippetId },
      })
      setPublishMenuOpen(false)
      toast.success(t('publishSuccess'))
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('publishFailed'))
    }
  }, [publishSnippetMutation, setPublishMenuOpen, snippetId, t])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (e) => {
    if (section !== 'orchestrate' || publishSnippetMutation.isPending)
      return

    e.preventDefault()
    void handlePublish()
  }, { exactMatch: true, useCapture: true })

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
                    isPublishing={publishSnippetMutation.isPending}
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
