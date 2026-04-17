import type { PanelProps } from '@/app/components/workflow/panel'
import type { SnippetInputField } from '@/models/snippet'
import { render, waitFor } from '@testing-library/react'
import SnippetWorkflowPanel from '../workflow-panel'

let capturedPanelProps: PanelProps | null = null

vi.mock('@/app/components/workflow/panel', () => ({
  default: (props: PanelProps) => {
    capturedPanelProps = props
    return <div data-testid="workflow-panel">{props.components?.left}</div>
  },
}))

const defaultFields: SnippetInputField[] = []

describe('SnippetWorkflowPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedPanelProps = null
  })

  // Verifies snippet panel wires version history support into the shared workflow panel.
  describe('Rendering', () => {
    it('should pass snippet version history panel props to the shared workflow panel', async () => {
      render(
        <SnippetWorkflowPanel
          snippetId="snippet-1"
          fields={defaultFields}
          editingField={null}
          isEditorOpen={false}
          isInputPanelOpen={false}
          onCloseInputPanel={vi.fn()}
          onOpenEditor={vi.fn()}
          onCloseEditor={vi.fn()}
          onSubmitField={vi.fn()}
          onRemoveField={vi.fn()}
          onSortChange={vi.fn()}
        />,
      )

      await waitFor(() => {
        expect(capturedPanelProps?.versionHistoryPanelProps?.getVersionListUrl).toBe('/snippets/snippet-1/workflows')
        expect(capturedPanelProps?.versionHistoryPanelProps?.deleteVersionUrl?.('version-1')).toBe('/snippets/snippet-1/workflows/version-1')
        expect(capturedPanelProps?.versionHistoryPanelProps?.restoreVersionUrl('version-1')).toBe('/snippets/snippet-1/workflows/version-1/restore')
        expect(capturedPanelProps?.versionHistoryPanelProps?.updateVersionUrl?.('version-1')).toBe('/snippets/snippet-1/workflows/version-1')
        expect(capturedPanelProps?.versionHistoryPanelProps?.latestVersionId).toBe('')
        expect(capturedPanelProps?.components?.right).toBeTruthy()
      })
    })
  })
})
