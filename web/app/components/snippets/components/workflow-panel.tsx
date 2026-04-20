'use client'

import type { PanelProps } from '@/app/components/workflow/panel'
import type { SnippetInputField } from '@/models/snippet'
import { memo, useMemo } from 'react'
import Panel from '@/app/components/workflow/panel'
import { useStore } from '@/app/components/workflow/store'
import dynamic from '@/next/dynamic'
import SnippetInputFieldEditor from './input-field-editor'
import SnippetInputFieldPanel from './panel'

const Record = dynamic(() => import('@/app/components/workflow/panel/record'), {
  ssr: false,
})
const SnippetRunPanel = dynamic(() => import('./snippet-run-panel'), {
  ssr: false,
})

type SnippetWorkflowPanelProps = {
  snippetId: string
  fields: SnippetInputField[]
  editingField: SnippetInputField | null
  isEditorOpen: boolean
  isInputPanelOpen: boolean
  onCloseInputPanel: () => void
  onOpenEditor: (field?: SnippetInputField | null) => void
  onCloseEditor: () => void
  onSubmitField: (field: SnippetInputField) => void
  onRemoveField: (index: number) => void
  onSortChange: (fields: SnippetInputField[]) => void
}

const SnippetPanelOnLeft = ({
  fields,
  editingField,
  isEditorOpen,
  isInputPanelOpen,
  onCloseInputPanel,
  onOpenEditor,
  onCloseEditor,
  onSubmitField,
  onRemoveField,
  onSortChange,
}: SnippetWorkflowPanelProps) => {
  return (
    <div className="hidden xl:flex">
      {isEditorOpen && (
        <SnippetInputFieldEditor
          field={editingField}
          onClose={onCloseEditor}
          onSubmit={onSubmitField}
        />
      )}
      {isInputPanelOpen && (
        <SnippetInputFieldPanel
          fields={fields}
          onClose={onCloseInputPanel}
          onAdd={() => onOpenEditor()}
          onEdit={onOpenEditor}
          onRemove={onRemoveField}
          onSortChange={onSortChange}
        />
      )}
    </div>
  )
}

const SnippetPanelOnRight = ({
  fields,
}: Pick<SnippetWorkflowPanelProps, 'fields'>) => {
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const showDebugAndPreviewPanel = useStore(s => s.showDebugAndPreviewPanel)

  return (
    <>
      {historyWorkflowData && <Record />}
      {showDebugAndPreviewPanel && <SnippetRunPanel fields={fields} />}
    </>
  )
}

const SnippetWorkflowPanel = ({
  snippetId,
  fields,
  editingField,
  isEditorOpen,
  isInputPanelOpen,
  onCloseInputPanel,
  onOpenEditor,
  onCloseEditor,
  onSubmitField,
  onRemoveField,
  onSortChange,
}: SnippetWorkflowPanelProps) => {
  const versionHistoryPanelProps = useMemo(() => {
    return {
      getVersionListUrl: `/snippets/${snippetId}/workflows`,
      deleteVersionUrl: (versionId: string) => `/snippets/${snippetId}/workflows/${versionId}`,
      restoreVersionUrl: (versionId: string) => `/snippets/${snippetId}/workflows/${versionId}/restore`,
      updateVersionUrl: (versionId: string) => `/snippets/${snippetId}/workflows/${versionId}`,
      latestVersionId: '',
    }
  }, [snippetId])

  const panelProps: PanelProps = useMemo(() => {
    return {
      components: {
        left: (
          <SnippetPanelOnLeft
            snippetId={snippetId}
            fields={fields}
            editingField={editingField}
            isEditorOpen={isEditorOpen}
            isInputPanelOpen={isInputPanelOpen}
            onCloseInputPanel={onCloseInputPanel}
            onOpenEditor={onOpenEditor}
            onCloseEditor={onCloseEditor}
            onSubmitField={onSubmitField}
            onRemoveField={onRemoveField}
            onSortChange={onSortChange}
          />
        ),
        right: <SnippetPanelOnRight fields={fields} />,
      },
      versionHistoryPanelProps,
    }
  }, [
    editingField,
    fields,
    isEditorOpen,
    isInputPanelOpen,
    onCloseEditor,
    onCloseInputPanel,
    onOpenEditor,
    onRemoveField,
    onSortChange,
    onSubmitField,
    snippetId,
    versionHistoryPanelProps,
  ])

  return <Panel {...panelProps} />
}

export default memo(SnippetWorkflowPanel)
