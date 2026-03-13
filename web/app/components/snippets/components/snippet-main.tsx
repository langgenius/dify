'use client'

import type { NavIcon } from '@/app/components/app-sidebar/nav-link'
import type { WorkflowProps } from '@/app/components/workflow'
import type { SnippetDetailPayload, SnippetInputField } from '@/models/snippet'
import {
  RiFlaskFill,
  RiFlaskLine,
  RiGitBranchFill,
  RiGitBranchLine,
} from '@remixicon/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import AppSideBar from '@/app/components/app-sidebar'
import NavLink from '@/app/components/app-sidebar/nav-link'
import SnippetInfo from '@/app/components/app-sidebar/snippet-info'
import { useStore as useAppStore } from '@/app/components/app/store'
import Toast from '@/app/components/base/toast'
import { WorkflowWithInnerContext } from '@/app/components/workflow'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useSnippetDetailStore } from '../store'
import SnippetChildren from './snippet-children'

type SnippetMainProps = {
  payload: SnippetDetailPayload
  snippetId: string
} & Pick<WorkflowProps, 'nodes' | 'edges' | 'viewport'>

const ORCHESTRATE_ICONS: { normal: NavIcon, selected: NavIcon } = {
  normal: RiGitBranchLine,
  selected: RiGitBranchFill,
}

const EVALUATION_ICONS: { normal: NavIcon, selected: NavIcon } = {
  normal: RiFlaskLine,
  selected: RiFlaskFill,
}

const SnippetMain = ({
  payload,
  snippetId,
  nodes,
  edges,
  viewport,
}: SnippetMainProps) => {
  const { t } = useTranslation('snippet')
  const { graph, snippet, uiMeta } = payload
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [fields, setFields] = useState<SnippetInputField[]>(payload.inputFields)
  const setAppSidebarExpand = useAppStore(state => state.setAppSidebarExpand)
  const {
    activeSection,
    editingField,
    isEditorOpen,
    isInputPanelOpen,
    isPublishMenuOpen,
    closeEditor,
    openEditor,
    reset,
    setActiveSection,
    setInputPanelOpen,
    toggleInputPanel,
    togglePublishMenu,
  } = useSnippetDetailStore(useShallow(state => ({
    activeSection: state.activeSection,
    editingField: state.editingField,
    isEditorOpen: state.isEditorOpen,
    isInputPanelOpen: state.isInputPanelOpen,
    isPublishMenuOpen: state.isPublishMenuOpen,
    closeEditor: state.closeEditor,
    openEditor: state.openEditor,
    reset: state.reset,
    setActiveSection: state.setActiveSection,
    setInputPanelOpen: state.setInputPanelOpen,
    toggleInputPanel: state.toggleInputPanel,
    togglePublishMenu: state.togglePublishMenu,
  })))

  useEffect(() => {
    reset()
  }, [reset, snippetId])

  useEffect(() => {
    const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
    const mode = isMobile ? 'collapse' : 'expand'
    setAppSidebarExpand(isMobile ? mode : localeMode)
  }, [isMobile, setAppSidebarExpand])

  const primaryFields = useMemo(() => fields.slice(0, 2), [fields])
  const secondaryFields = useMemo(() => fields.slice(2), [fields])

  const handlePrimarySortChange = (newFields: SnippetInputField[]) => {
    setFields([...newFields, ...secondaryFields])
  }

  const handleSecondarySortChange = (newFields: SnippetInputField[]) => {
    setFields([...primaryFields, ...newFields])
  }

  const handleRemoveField = (index: number) => {
    setFields(current => current.filter((_, currentIndex) => currentIndex !== index))
  }

  const handleSubmitField = (field: SnippetInputField) => {
    const originalVariable = editingField?.variable
    const duplicated = fields.some(item => item.variable === field.variable && item.variable !== originalVariable)

    if (duplicated) {
      Toast.notify({
        type: 'error',
        message: t('inputFieldPanel.error.variableDuplicate', { ns: 'datasetPipeline' }),
      })
      return
    }

    if (originalVariable)
      setFields(current => current.map(item => item.variable === originalVariable ? field : item))
    else
      setFields(current => [...current, field])

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
              active={activeSection === 'orchestrate'}
              onClick={() => setActiveSection('orchestrate')}
            />
            <NavLink
              mode={mode}
              name={t('sectionEvaluation')}
              iconMap={EVALUATION_ICONS}
              active={activeSection === 'evaluation'}
              onClick={() => setActiveSection('evaluation')}
            />
          </>
        )}
      />

      <div className="relative min-h-0 min-w-0 grow overflow-hidden">
        <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
          <WorkflowWithInnerContext
            nodes={nodes}
            edges={edges}
            viewport={viewport ?? graph.viewport}
          >
            <SnippetChildren
              fields={fields}
              uiMeta={uiMeta}
              editingField={editingField}
              isEditorOpen={isEditorOpen}
              isInputPanelOpen={isInputPanelOpen}
              isPublishMenuOpen={isPublishMenuOpen}
              onToggleInputPanel={handleToggleInputPanel}
              onTogglePublishMenu={togglePublishMenu}
              onCloseInputPanel={handleCloseInputPanel}
              onOpenEditor={openEditor}
              onCloseEditor={closeEditor}
              onSubmitField={handleSubmitField}
              onRemoveField={handleRemoveField}
              onPrimarySortChange={handlePrimarySortChange}
              onSecondarySortChange={handleSecondarySortChange}
            />
          </WorkflowWithInnerContext>
        </div>
      </div>
    </div>
  )
}

export default SnippetMain
