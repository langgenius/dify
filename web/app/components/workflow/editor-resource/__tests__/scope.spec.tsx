import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { useStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { EditorResourceScope } from '../provider'
import { getEditorResourceId } from '../resource'
import { editorResourceAtom, isChatflowAtom } from '../state'
import { renderEditorHook } from './render'

function ResourceSummary({ label }: { label: string }) {
  const id = getEditorResourceId(useAtomValue(editorResourceAtom))
  const isChatflow = useAtomValue(isChatflowAtom)
  return <output aria-label={label}>{`${id}:${isChatflow ? 'chatflow' : 'other'}`}</output>
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
  it('preserves shared App details when the editor unmounts after a failed background refresh', async () => {
    const queryClient = createConsoleQueryClient()
    const app = createAppDetailFixture({ id: 'app-1', mode: 'workflow', name: 'Workflow' })
    const queryKey = consoleQuery.apps.byAppId.get.queryKey({
      input: { params: { app_id: app.id } },
    })
    seedAppDetail(queryClient, app)
    const { unmount } = render(
      <QueryClientTestProvider queryClient={queryClient}>
        <EditorResourceScope resource={{ kind: 'app', appId: app.id, mode: 'workflow' }}>
          <ResourceSummary label="Editor" />
        </EditorResourceScope>
      </QueryClientTestProvider>,
    )
    const error = new Error('App detail refresh failed')
    await act(async () => {
      await expect(
        queryClient.query({ queryKey, staleTime: 0, queryFn: () => Promise.reject(error) }),
      ).rejects.toThrow(error)
    })
    expect(queryClient.getQueryState(queryKey)?.status).toBe('error')
    expect(screen.getByLabelText('Editor')).toHaveTextContent('app-1:other')

    unmount()

    expect(queryClient.getQueryData(queryKey)).toEqual(app)
    expect(queryClient.getQueryState(queryKey)?.status).toBe('error')
  })

  it('isolates simultaneous App editors with different modes alongside pipeline and snippet editors', () => {
    const queryClient = createConsoleQueryClient()
    seedAppDetail(
      queryClient,
      createAppDetailFixture({ id: 'app-1', mode: 'advanced-chat', name: 'Chatflow' }),
    )
    render(
      <QueryClientTestProvider queryClient={queryClient}>
        <EditorResourceScope resource={{ kind: 'app', appId: 'app-1', mode: 'advanced-chat' }}>
          <ResourceSummary label="App" />
        </EditorResourceScope>
        <EditorResourceScope resource={{ kind: 'app', appId: 'app-2', mode: 'workflow' }}>
          <ResourceSummary label="Second App" />
        </EditorResourceScope>
        <EditorResourceScope resource={{ kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' }}>
          <ResourceSummary label="Pipeline" />
        </EditorResourceScope>
        <EditorResourceScope resource={{ kind: 'snippet', snippetId: 'snippet-1' }}>
          <ResourceSummary label="Snippet" />
        </EditorResourceScope>
      </QueryClientTestProvider>,
    )
    expect(screen.getByLabelText('App')).toHaveTextContent('app-1:chatflow')
    expect(screen.getByLabelText('Second App')).toHaveTextContent('app-2:other')
    expect(screen.getByLabelText('Pipeline')).toHaveTextContent('pipeline-1:other')
    expect(screen.getByLabelText('Snippet')).toHaveTextContent('snippet-1:other')
  })

  it('keeps the supplied resource mode independent of cached App details', () => {
    const queryClient = createConsoleQueryClient()
    const app = createAppDetailFixture({ id: 'app-1', mode: 'workflow' })
    seedAppDetail(queryClient, app)
    const resource = { kind: 'app', appId: app.id, mode: 'advanced-chat' } as const
    const { result } = renderEditorHook(() => useAtomValue(editorResourceAtom), {
      queryClient,
      resource,
    })
    expect(result.current).toEqual(resource)
    expect(
      queryClient.getQueryData(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: app.id } } }),
      ),
    ).toEqual(app)
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
        <EditorResourceScope
          resource={{ kind: 'app', appId, mode: appId === 'app-1' ? 'workflow' : 'advanced-chat' }}
        >
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
    await waitFor(() => expect(screen.getByLabelText('Editor')).toHaveTextContent('app-1:other'))
    rerender(view('app-1'))
    expect(screen.getByRole('textbox', { name: 'Unsaved draft' })).toHaveValue(
      'Unpublished changes',
    )
    expect(screen.getByRole('region', { name: 'Preview' })).toBeVisible()

    rerender(view('app-2'))
    expect(screen.getByLabelText('Editor')).toHaveTextContent('app-2:chatflow')
    expect(screen.getByRole('textbox', { name: 'Unsaved draft' })).toHaveValue('')
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()
  })
})
