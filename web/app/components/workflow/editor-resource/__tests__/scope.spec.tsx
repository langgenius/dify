import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { useStore } from '@/app/components/workflow/store'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { EditorResourceScope } from '../provider'
import { getEditorResourceId } from '../resource'
import { editorAppNameAtom, editorResourceAtom, isChatflowAtom } from '../state'

function ResourceSummary({ label }: { label: string }) {
  const id = getEditorResourceId(useAtomValue(editorResourceAtom))
  const isChatflow = useAtomValue(isChatflowAtom)
  const name = useAtomValue(editorAppNameAtom)
  return (
    <output aria-label={label}>{`${id}:${isChatflow ? 'chatflow' : 'other'}:${name ?? ''}`}</output>
  )
}

function EditorSession() {
  const [draft, setDraft] = useState('')
  const showPreview = useStore((state) => state.showDebugAndPreviewPanel)
  const setShowPreview = useStore((state) => state.setShowDebugAndPreviewPanel)

  return (
    <>
      <ResourceSummary label="Editor" />
      <input
        aria-label="Unsaved draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" onClick={() => setShowPreview(true)}>
        Open preview
      </button>
      {showPreview && <section aria-label="Preview">Preview is open</section>}
    </>
  )
}

describe('workflow editor resource scope', () => {
  it('isolates simultaneous app, pipeline and snippet editors', () => {
    const queryClient = createConsoleQueryClient()
    seedAppDetail(
      queryClient,
      createAppDetailFixture({ id: 'app-1', mode: 'advanced-chat', name: 'Chatflow' }),
    )
    render(
      <QueryClientTestProvider queryClient={queryClient}>
        <EditorResourceScope identity={{ kind: 'app', appId: 'app-1' }}>
          <ResourceSummary label="App" />
        </EditorResourceScope>
        <EditorResourceScope identity={{ kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' }}>
          <ResourceSummary label="Pipeline" />
        </EditorResourceScope>
        <EditorResourceScope identity={{ kind: 'snippet', snippetId: 'snippet-1' }}>
          <ResourceSummary label="Snippet" />
        </EditorResourceScope>
      </QueryClientTestProvider>,
    )
    expect(screen.getByLabelText('App')).toHaveTextContent('app-1:chatflow:Chatflow')
    expect(screen.getByLabelText('Pipeline')).toHaveTextContent('pipeline-1:other:')
    expect(screen.getByLabelText('Snippet')).toHaveTextContent('snippet-1:other:')
  })

  it('updates app facts from the query cache and switches resource identity', async () => {
    const queryClient = createConsoleQueryClient()
    seedAppDetail(
      queryClient,
      createAppDetailFixture({ id: 'app-1', mode: 'workflow', name: 'First' }),
    )
    seedAppDetail(
      queryClient,
      createAppDetailFixture({ id: 'app-2', mode: 'advanced-chat', name: 'Second' }),
    )
    const view = (appId: string) => (
      <QueryClientTestProvider queryClient={queryClient}>
        <EditorResourceScope identity={{ kind: 'app', appId }}>
          <ResourceSummary label="Editor" />
        </EditorResourceScope>
      </QueryClientTestProvider>
    )
    const { rerender } = render(view('app-1'))
    expect(screen.getByLabelText('Editor')).toHaveTextContent('app-1:other:First')
    await act(async () => {
      seedAppDetail(
        queryClient,
        createAppDetailFixture({ id: 'app-1', mode: 'workflow', name: 'Renamed' }),
      )
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Editor')).toHaveTextContent('app-1:other:Renamed'),
    )
    rerender(view('app-2'))
    expect(screen.getByLabelText('Editor')).toHaveTextContent('app-2:chatflow:Second')
  })

  it('preserves the editor session when app facts refresh and resets it when the resource changes', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    seedAppDetail(
      queryClient,
      createAppDetailFixture({ id: 'app-1', mode: 'workflow', name: 'First' }),
    )
    seedAppDetail(
      queryClient,
      createAppDetailFixture({ id: 'app-2', mode: 'advanced-chat', name: 'Second' }),
    )
    const view = (appId: string) => (
      <QueryClientTestProvider queryClient={queryClient}>
        <EditorResourceScope identity={{ kind: 'app', appId }}>
          <WorkflowContextProvider>
            <EditorSession />
          </WorkflowContextProvider>
        </EditorResourceScope>
      </QueryClientTestProvider>
    )
    const { rerender } = render(view('app-1'))

    await user.type(screen.getByRole('textbox', { name: 'Unsaved draft' }), 'Unpublished changes')
    await user.click(screen.getByRole('button', { name: 'Open preview' }))

    await act(async () => {
      seedAppDetail(
        queryClient,
        createAppDetailFixture({ id: 'app-1', mode: 'workflow', name: 'Renamed' }),
      )
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Editor')).toHaveTextContent('app-1:other:Renamed'),
    )
    rerender(view('app-1'))
    expect(screen.getByRole('textbox', { name: 'Unsaved draft' })).toHaveValue(
      'Unpublished changes',
    )
    expect(screen.getByRole('region', { name: 'Preview' })).toBeVisible()

    rerender(view('app-2'))
    expect(screen.getByLabelText('Editor')).toHaveTextContent('app-2:chatflow:Second')
    expect(screen.getByRole('textbox', { name: 'Unsaved draft' })).toHaveValue('')
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()
  })
})
