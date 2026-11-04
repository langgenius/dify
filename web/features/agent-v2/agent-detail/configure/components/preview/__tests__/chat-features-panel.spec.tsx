import type { AgentSoulAppFeaturesConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AnnotationSettingResponse } from '@dify/contracts/api/console/apps/types.gen'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { agentComposerAppFeaturesAtom } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { AgentChatFeaturesPanel } from '../chat-features-panel'

const { getAnnotationSetting, updateAnnotationStatus, getAnnotationJobStatus } = vi.hoisted(() => ({
  getAnnotationSetting: vi.fn(),
  updateAnnotationStatus: vi.fn(),
  getAnnotationJobStatus: vi.fn(),
}))

vi.mock('@/context/hooks/use-trigger-events-limit-modal', () => ({
  useTriggerEventsLimitModal: () => ({ triggerEventsLimitModal: null }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotationSetting.get': (input) => getAnnotationSetting(input),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.annotationReply.byAction.post': (input) => updateAnnotationStatus(input),
      'apps.byAppId.annotationReply.byAction.status.byJobId.get': (input) =>
        getAnnotationJobStatus(input),
    }),
  }
})

const backingAppId = 'backing-app-1'
const annotationSettingKey = () =>
  consoleQuery.apps.byAppId.annotationSetting.get.queryKey({
    input: { params: { app_id: backingAppId } },
  })

function PanelHarness({
  snapshot,
  annotationReplyAppId,
  disabled = false,
}: {
  snapshot: AgentSoulAppFeaturesConfig
  annotationReplyAppId?: string
  disabled?: boolean
}) {
  const [show, setShow] = useState(true)
  return (
    <>
      <button onClick={() => setShow(true)}>Open features</button>
      <AgentChatFeaturesPanel
        appFeatures={snapshot}
        annotationReplyAppId={annotationReplyAppId}
        disabled={disabled}
        show={show}
        onClose={() => setShow(false)}
      />
    </>
  )
}

function renderPanel(
  snapshot: AgentSoulAppFeaturesConfig,
  draft = snapshot,
  disabled = false,
  {
    annotationReplyAppId,
    annotationSetting,
    defaultRetry,
  }: {
    annotationReplyAppId?: string
    annotationSetting?: AnnotationSettingResponse
    defaultRetry?: number
  } = {},
) {
  const queryClient = createConsoleQueryClient()
  if (defaultRetry !== undefined) {
    queryClient.setDefaultOptions({
      ...queryClient.getDefaultOptions(),
      queries: { ...queryClient.getDefaultOptions().queries, retry: defaultRetry },
    })
  }
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  store.set(agentComposerAppFeaturesAtom, draft)
  const ui = (currentSnapshot: AgentSoulAppFeaturesConfig) => (
    <Provider store={store}>
      <NuqsTestingAdapter>
        <ModalContextProvider>
          <PanelHarness
            snapshot={currentSnapshot}
            annotationReplyAppId={annotationReplyAppId}
            disabled={disabled}
          />
        </ModalContextProvider>
      </NuqsTestingAdapter>
    </Provider>
  )
  seedModelProviderQueries(queryClient)
  if (annotationSetting) queryClient.setQueryData(annotationSettingKey(), annotationSetting)
  const rendered = renderWithConsoleQuery(ui(snapshot), {
    queryClient,
    features: { annotation_quota_limit: { size: 0, limit: 10 } },
  })
  return {
    ...rendered,
    queryClient,
    store,
    updateSnapshot: (next: AgentSoulAppFeaturesConfig) => rendered.rerender(ui(next)),
  }
}

describe('AgentChatFeaturesPanel', () => {
  beforeEach(() => {
    getAnnotationSetting.mockReset().mockReturnValue(new Promise(() => {}))
    updateAnnotationStatus.mockReset().mockResolvedValue({ job_id: 'job-1', job_status: 'waiting' })
    getAnnotationJobStatus.mockReset().mockResolvedValue({ job_status: 'completed' })
  })

  it('does not offer annotation reply without a backing app', () => {
    renderPanel({})

    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.showThoughts.title' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'appDebug.feature.annotation.title' }),
    ).not.toBeInTheDocument()
  })

  it('shows the backing app annotation reply setting and links to its annotations', async () => {
    const user = userEvent.setup({ skipHover: true })
    renderPanel({}, {}, false, {
      annotationReplyAppId: backingAppId,
      annotationSetting: {
        enabled: true,
        id: 'setting-1',
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'embedding-model',
        },
      },
    })

    expect(screen.getByRole('switch', { name: 'appDebug.feature.annotation.title' })).toBeChecked()
    expect(screen.getByText('0.9')).toBeInTheDocument()
    await user.hover(screen.getByText('appDebug.feature.annotation.title'))
    expect(
      screen.getByRole('link', { name: /feature.annotation.cacheManagement/ }),
    ).toHaveAttribute('href', `/app/${backingAppId}/annotations`)
  })

  it('saves annotation reply on the backing app without changing the Agent draft', async () => {
    const user = userEvent.setup({ skipHover: true })
    const draft: AgentSoulAppFeaturesConfig = { show_thoughts: { enabled: true } }
    const { store } = renderPanel(draft, draft, false, {
      annotationReplyAppId: backingAppId,
      annotationSetting: { enabled: true, id: 'setting-1', score_threshold: 0.9 },
    })
    const toggle = screen.getByRole('switch', { name: 'appDebug.feature.annotation.title' })

    await user.click(toggle)

    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(updateAnnotationStatus).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ params: { app_id: backingAppId, action: 'disable' } }),
    )
    expect(getAnnotationSetting).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: backingAppId },
    })
    expect(store.get(agentComposerAppFeaturesAtom)).toBe(draft)
  })

  it('shows the panel while the backing app setting loads and adds annotation reply once it arrives', async () => {
    const setting = createDeferred<AnnotationSettingResponse>()
    getAnnotationSetting.mockReturnValueOnce(setting.promise)
    renderPanel({}, {}, false, { annotationReplyAppId: backingAppId })

    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.showThoughts.title' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'appDebug.feature.annotation.title' }),
    ).not.toBeInTheDocument()
    expect(getAnnotationSetting).toHaveBeenCalledWith({ params: { app_id: backingAppId } })
    await act(async () => setting.resolve({ enabled: true, id: 'setting-1', score_threshold: 0.9 }))

    expect(
      await screen.findByRole('switch', { name: 'appDebug.feature.annotation.title' }),
    ).toBeChecked()
  })

  it('leaves annotation reply out at once when the backing app rejects the setting request', async () => {
    getAnnotationSetting.mockRejectedValue(new ORPCError('NOT_FOUND', { status: 404 }))
    // The production QueryClient keeps the default of three retries.
    const { queryClient } = renderPanel({}, {}, false, {
      annotationReplyAppId: backingAppId,
      defaultRetry: 3,
    })

    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.showThoughts.title' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(queryClient.getQueryState(annotationSettingKey())?.status).toBe('error'),
    )
    expect(getAnnotationSetting).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('switch', { name: 'appDebug.feature.annotation.title' }),
    ).not.toBeInTheDocument()
  })

  it('defaults thinking display off and saves toggles without changing citations', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel({ retriever_resource: { enabled: true } })
    const toggle = screen.getByRole('switch', { name: 'appDebug.feature.showThoughts.title' })

    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(toggle).toBeChecked()
    expect(store.get(agentComposerAppFeaturesAtom)?.show_thoughts).toEqual({ enabled: true })
    expect(store.get(agentComposerAppFeaturesAtom)?.retriever_resource).toEqual({ enabled: true })
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(store.get(agentComposerAppFeaturesAtom)?.show_thoughts).toEqual({ enabled: false })
  })

  it('shows the published thinking setting read-only without changing the draft', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel(
      { show_thoughts: { enabled: true } },
      { show_thoughts: { enabled: false } },
      true,
    )
    const toggle = screen.getByRole('switch', { name: 'appDebug.feature.showThoughts.title' })

    expect(toggle).toBeChecked()
    expect(toggle).toHaveAttribute('aria-disabled', 'true')
    await user.click(toggle)
    expect(store.get(agentComposerAppFeaturesAtom)?.show_thoughts).toEqual({ enabled: false })
  })

  it('keeps a newly saved opener enabled before the server snapshot catches up', async () => {
    const user = userEvent.setup({ skipHover: true })
    const { updateSnapshot, store } = renderPanel({ opening_statement: '' })

    await user.click(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    )
    await user.hover(screen.getByText('appDebug.feature.conversationOpener.title'))
    await user.click(screen.getByRole('button', { name: 'appDebug.openingStatement.writeOpener' }))
    const editor = await screen.findByRole('textbox')
    await user.click(editor)
    await user.paste('Hello from the unsaved draft')
    updateSnapshot({ opening_statement: '', suggested_questions: [] })
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(await screen.findByText('Hello from the unsaved draft')).toBeVisible()
    expect(store.get(agentComposerAppFeaturesAtom)?.opening_statement).toBe(
      'Hello from the unsaved draft',
    )
    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    ).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('switch')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Open features' }))
    expect(await screen.findByText('Hello from the unsaved draft')).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    ).toBeChecked()
  })

  it('initializes editable features from the current draft instead of the stale snapshot', () => {
    renderPanel({ opening_statement: '' }, { opening_statement: 'Current draft opener' })
    expect(screen.getByText('Current draft opener')).toBeVisible()
    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    ).toBeChecked()
  })

  it('shows the selected snapshot without changing the editable draft in read-only mode', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel(
      { opening_statement: 'Published opener' },
      { opening_statement: 'Current draft opener' },
      true,
    )
    expect(screen.getByText('Published opener')).toBeVisible()
    expect(screen.queryByText('Current draft opener')).not.toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' }),
    ).toBeChecked()
    const opener = screen.getByRole('switch', { name: 'appDebug.feature.conversationOpener.title' })
    expect(opener).toHaveAttribute('aria-disabled', 'true')
    await user.click(opener)
    expect(store.get(agentComposerAppFeaturesAtom)?.opening_statement).toBe('Current draft opener')
  })
})
