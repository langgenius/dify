import type {
  KnowledgeFsSettingsResponse,
  KnowledgeFsSourceWorkflowResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { SyncPolicyValue } from '../../setup/sync-policy-field'
import type { Source, SourceWorkflowRun } from '../../source-models'
import type { TestNavigation } from '@/test/next-navigation'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createErrorToastCaches } from '@/app/query-error-toast'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { CrawlSelectionForm } from '../crawl-selection-form'

let navigation: TestNavigation
const settingsState = {
  configurationState: 'active' as 'active' | 'setup-required',
}

const workflowApiResponse = (workflow: SourceWorkflowRun) => ({
  canceled_at: workflow.canceledAt ?? null,
  checkpoint: workflow.checkpoint,
  completed_at: workflow.completedAt ?? null,
  created_at: workflow.createdAt,
  cursor: workflow.cursor ?? null,
  execution_attempts: workflow.executionAttempts,
  id: workflow.id,
  knowledge_space_id: workflow.knowledgeSpaceId,
  kind: workflow.kind,
  last_error_code: (workflow.lastErrorCode ??
    null) as KnowledgeFsSourceWorkflowResponse['last_error_code'],
  max_execution_attempts: workflow.maxExecutionAttempts,
  progress_completed: workflow.progressCompleted,
  progress_failed: workflow.progressFailed,
  progress_skipped: workflow.progressSkipped,
  progress_total: workflow.progressTotal ?? null,
  source_id: workflow.sourceId ?? null,
  state: workflow.state,
  updated_at: workflow.updatedAt,
})

const settingsResponse = (): KnowledgeFsSettingsResponse => {
  const active = settingsState.configurationState === 'active'
  return {
    active_profile_available: active,
    active_profile_revisions: active ? { embedding: 1, retrieval: 1 } : {},
    capabilities: {
      deep: active,
      index: active,
      ingest: active,
      query: active,
      research: active,
      source_sync: active,
    },
    configuration_state: settingsState.configurationState,
    embedding: null,
    issues: [],
    retrieval: null,
    revision: 1,
  }
}

const source: Source = {
  connectionId: 'connection-1',
  createdAt: '2026-07-20T10:00:00Z',
  id: 'source-1',
  knowledgeSpaceId: 'space-1',
  metadata: {},
  name: 'Dify docs',
  status: 'disabled',
  type: 'web',
  updatedAt: '2026-07-20T10:00:00Z',
  uri: 'https://docs.dify.ai/',
  version: 3,
}

const run: SourceWorkflowRun = {
  checkpoint: 'crawl',
  createdAt: '2026-07-20T10:00:00Z',
  executionAttempts: 1,
  id: 'run-1',
  knowledgeSpaceId: 'space-1',
  kind: 'crawl-preview',
  maxExecutionAttempts: 3,
  progressCompleted: 3,
  progressFailed: 1,
  progressSkipped: 0,
  progressTotal: 4,
  sourceId: source.id,
  state: 'succeeded',
  updatedAt: '2026-07-20T10:01:00Z',
}

const fake = setupFakeApi(() => ({
  console: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          settings: { get: () => settingsResponse() },
          sources: {
            bySourceId: {
              asyncImport: {
                post: async () =>
                  workflowApiResponse({ ...run, checkpoint: 'import', state: 'queued' }),
              },
            },
          },
        },
      },
    },
  },
}))

const pages = [
  {
    pageId: 'page-1',
    sourceUrl: 'https://docs.dify.ai/getting-started',
    title: 'Getting started',
  },
  {
    pageId: 'page-2',
    sourceUrl: 'https://docs.dify.ai/guides',
    title: 'Guides',
  },
  {
    pageId: 'off-domain',
    sourceUrl: 'https://github.com/langgenius/dify/edit/main/docs.md',
    title: 'Edit this page',
  },
]

async function renderSelectionForm({
  initialSelectedPageIds,
  initialSyncMode,
  syncPolicyValue,
  workflowUncertain = false,
  previewPages = pages,
}: {
  initialSelectedPageIds?: readonly string[]
  initialSyncMode?: 'custom' | 'interval' | 'manual'
  syncPolicyValue?: SyncPolicyValue
  workflowUncertain?: boolean
  previewPages?: typeof pages
} = {}) {
  function SourceSetup() {
    const [locked, setLocked] = useState(false)
    const [canceled, setCanceled] = useState(false)
    const [recrawling, setRecrawling] = useState(false)
    const [accepted, setAccepted] = useState<SourceWorkflowRun>()
    return (
      <>
        <button disabled={locked} type="button">
          Leave source setup
        </button>
        {recrawling && <p>Preview requested</p>}
        {canceled ? (
          <p>Source setup closed</p>
        ) : (
          <CrawlSelectionForm
            discardRequested={() => false}
            initialSelectedPageIds={initialSelectedPageIds}
            initialSyncMode={initialSyncMode}
            knowledgeSpaceId="space-1"
            onCancel={() => setCanceled(true)}
            onInteractionLockChange={setLocked}
            onRecrawl={() => setRecrawling(true)}
            onSubmissionUncertainChange={() => {}}
            onSubmitted={() => {}}
            onWorkflowPending={() => {}}
            onWorkflowRun={setAccepted}
            pages={previewPages}
            rootUrl="https://docs.dify.ai/"
            run={run}
            showSyncPolicyField={!syncPolicyValue}
            source={source}
            syncPolicyValue={syncPolicyValue}
            workflowUncertain={workflowUncertain}
          />
        )}
        {accepted && (
          <output aria-label="Accepted import">
            {accepted.id}: {accepted.state}
          </output>
        )}
      </>
    )
  }
  // The app's cache-level error toasts, so a failure's messages can be counted.
  const { wrapper: QueryProvider } = createConsoleQueryWrapper({
    queryClient: createConsoleQueryClient({ caches: createErrorToastCaches() }),
  })
  navigation = createTestNavigation({ url: '/datasets/new/space-1/sources/new/website' })
  const { NavigationProvider } = navigation
  return render(
    <NavigationProvider>
      <QueryProvider>
        <SourceSetup />
        <AppToaster />
      </QueryProvider>
    </NavigationProvider>,
  )
}

async function selectSyncPolicy(user: typeof userEvent, mode: 'custom' | 'interval' | 'manual') {
  const optionNames = {
    custom: 'knowledgeSources.syncPolicyCustom',
    interval: 'knowledgeSources.syncPolicyDaily',
    manual: 'knowledgeSources.syncPolicyManual',
  }
  await user.click(page.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' }))
  await user.click(page.getByRole('option', { name: optionNames[mode] }))
}

describe('CrawlSelectionForm', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
    settingsState.configurationState = 'active'
  })

  it('prompts for model setup before submitting the import', async () => {
    const user = userEvent
    // The guard reads the native query string, so establish this route's query at the browser boundary.
    const runnerUrl = window.location.href
    onTestFinished(() => window.history.replaceState(null, '', runnerUrl))
    window.history.replaceState(null, '', window.location.pathname)
    settingsState.configurationState = 'setup-required'
    await renderSelectionForm()
    await user.click(page.getByRole('checkbox', { name: 'Getting started' }))
    await user.click(page.getByRole('button', { name: 'knowledgeSpace.addSource' }))

    const configure = page.getByRole('button', {
      name: 'modelProvider.modelProvider.selector.configure',
    })
    await expect.element(configure).toBeVisible()
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post,
    ).not.toHaveBeenCalled()
    await user.click(configure)
    expect(navigation.router.push).toHaveBeenCalledWith(
      '/datasets/new/space-1/settings?returnTo=%2Fdatasets%2Fnew%2Fspace-1%2Fsources%2Fnew%2Fwebsite&capability=ingest',
    )
  })

  it('preserves the sync policy selected before crawl review', async () => {
    await renderSelectionForm({ initialSyncMode: 'manual' })
    await expect
      .element(page.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' }))
      .toHaveTextContent('knowledgeSources.syncPolicyManual')
  })

  it('selects only valid same-domain pages', async () => {
    const user = userEvent
    await renderSelectionForm()
    const addSource = page.getByRole('button', { name: 'knowledgeSpace.addSource' })
    await expect.element(addSource).toBeDisabled()
    await expect
      .element(page.getByRole('checkbox', { name: 'Edit this page' }))
      .toHaveAttribute('aria-disabled', 'true')

    await user.click(page.getByRole('checkbox', { name: 'Getting started' }))
    await expect.element(addSource).toBeEnabled()
    await expect
      .element(page.getByRole('checkbox', { name: 'knowledgeSources.selectAll' }))
      .toHaveAttribute('aria-checked', 'mixed')
    await user.click(page.getByRole('checkbox', { name: 'knowledgeSources.selectAll' }))
    await expect.element(page.getByRole('checkbox', { name: 'Guides' })).toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: 'Edit this page' })).not.toBeChecked()
  })

  it('keeps only valid initial selections', async () => {
    await renderSelectionForm({ initialSelectedPageIds: ['page-1', 'off-domain'] })
    await expect.element(page.getByRole('checkbox', { name: 'Getting started' })).toBeChecked()
    await expect.element(page.getByRole('checkbox', { name: 'Edit this page' })).not.toBeChecked()
  })

  it('locks stale selections while keeping recrawl and cancel available', async () => {
    await renderSelectionForm({ workflowUncertain: true })
    await expect
      .element(page.getByRole('checkbox', { name: 'Getting started' }))
      .toHaveAttribute('aria-disabled', 'true')
    await expect
      .element(page.getByRole('button', { name: 'knowledgeSpace.addSource' }))
      .toBeDisabled()
    await page.getByRole('button', { name: 'knowledgeSources.reCrawl' }).click()
    await expect.element(page.getByText('Preview requested')).toBeVisible()
    await page.getByRole('button', { name: 'knowledgeSources.cancelAddSource' }).click()
    await expect.element(page.getByText('Source setup closed')).toBeVisible()
    await expect
      .element(page.getByRole('checkbox', { name: 'Getting started' }))
      .not.toBeInTheDocument()
  })

  it('never submits more page IDs than the async import contract accepts', async () => {
    const longPageList = Array.from({ length: 201 }, (_, index) => ({
      pageId: `page-${index + 1}`,
      sourceUrl: `https://docs.dify.ai/page-${index + 1}`,
      title: `Page ${index + 1}`,
    }))
    const user = userEvent
    await renderSelectionForm({ previewPages: longPageList })
    await user.click(page.getByRole('checkbox', { name: 'knowledgeSources.selectAll' }))
    await user.click(page.getByRole('button', { name: 'knowledgeSpace.addSource' }))

    await vi.waitFor(() =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post,
      ).toHaveBeenCalledOnce(),
    )
    const [{ body }] =
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post.mock
        .calls[0]!
    expect('pageIds' in body && body.pageIds).toHaveLength(200)
  })

  it('submits custom policy in one request and navigates on acceptance', async () => {
    const user = userEvent
    await renderSelectionForm()
    await user.click(page.getByRole('checkbox', { name: 'Getting started' }))
    await selectSyncPolicy(user, 'custom')
    const dialog = page.getByRole('dialog', {
      name: 'knowledgeSources.syncPolicyCustom',
    })
    const interval = dialog.getByRole('textbox', {
      name: 'knowledgeSources.syncPolicyCustom knowledgeSpace.syncPolicyUnit.hours',
    })
    await interval.fill('6')
    await expect.element(interval).toHaveValue('6')
    await user.keyboard('{Enter}')
    await expect.element(dialog).not.toBeInTheDocument()
    await user.click(page.getByRole('button', { name: 'knowledgeSpace.addSource' }))

    await expect
      .poll(
        () => fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post,
      )
      .toHaveBeenCalledWith({
        body: {
          kind: 'crawl-preview-selection',
          pageIds: ['page-1'],
          previewWorkflowId: 'run-1',
          syncPolicy: {
            customIntervalSeconds: 21600,
            enabled: true,
            mode: 'custom',
          },
        },
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      })
    await vi.waitFor(() =>
      expect(navigation.router.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
    await expect
      .element(page.getByRole('status', { name: 'Accepted import' }))
      .toHaveTextContent('run-1: queued')
  })

  it.each([
    { enabled: false, mode: 'manual' },
    { enabled: true, mode: 'interval' },
  ] as const)('includes the $mode policy in the async import', async ({ enabled, mode }) => {
    const user = userEvent
    await renderSelectionForm()
    await user.click(page.getByRole('checkbox', { name: 'Getting started' }))
    await selectSyncPolicy(user, mode)
    await user.click(page.getByRole('button', { name: 'knowledgeSpace.addSource' }))

    await vi.waitFor(() =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post,
      ).toHaveBeenCalledOnce(),
    )
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post.mock
        .calls[0]?.[0].body.syncPolicy,
    ).toEqual({ enabled, mode })
  })

  it('keeps the form locked only until the async submission is accepted', async () => {
    const request = createDeferred<ReturnType<typeof workflowApiResponse>>()
    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post.mockReturnValue(
      request.promise,
    )
    const user = userEvent
    await renderSelectionForm()
    await user.click(page.getByRole('checkbox', { name: 'Getting started' }))
    await user.click(page.getByRole('button', { name: 'knowledgeSpace.addSource' }))

    await expect.element(page.getByRole('button', { name: 'Leave source setup' })).toBeDisabled()
    await expect
      .element(page.getByRole('checkbox', { name: 'Getting started' }))
      .toHaveAttribute('aria-disabled', 'true')
    await expect
      .element(page.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' }))
      .toBeDisabled()
    request.resolve(workflowApiResponse({ ...run, checkpoint: 'import', state: 'queued' }))
    await expect
      .element(page.getByRole('status', { name: 'Accepted import' }))
      .toHaveTextContent('run-1: queued')
    await expect.element(page.getByRole('button', { name: 'Leave source setup' })).toBeEnabled()
    await expect
      .element(page.getByRole('checkbox', { name: 'Getting started' }))
      .not.toHaveAttribute('aria-disabled', 'true')
  })

  it('reuses the idempotency key when an async import response is lost', async () => {
    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post
      .mockRejectedValueOnce(
        apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'response lost' }),
      )
      .mockResolvedValueOnce(workflowApiResponse({ ...run, checkpoint: 'import', state: 'queued' }))
    const user = userEvent
    await renderSelectionForm()
    await user.click(page.getByRole('checkbox', { name: 'Getting started' }))
    await user.click(page.getByRole('button', { name: 'knowledgeSpace.addSource' }))

    // The form shows its own text once for an uncataloged code; the cache adds no toast for it.
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('knowledgeSources.addSourceFailed')
    expect(page.getByText('knowledgeSources.addSourceFailed').elements()).toHaveLength(1)
    await expect.element(page.getByRole('button', { name: 'Leave source setup' })).toBeDisabled()
    await expect
      .element(page.getByRole('checkbox', { name: 'Getting started' }))
      .toHaveAttribute('aria-disabled', 'true')
    await expect
      .element(page.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' }))
      .toBeDisabled()
    await user.click(page.getByRole('button', { name: 'knowledgeSpace.addSource' }))

    await vi.waitFor(() =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post,
      ).toHaveBeenCalledTimes(2),
    )
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post.mock
        .calls[0]?.[0].headers,
    ).toEqual(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post.mock
        .calls[1]?.[0].headers,
    )
    await vi.waitFor(() =>
      expect(navigation.router.push).toHaveBeenCalledWith('/datasets/new/space-1/sources'),
    )
    await expect
      .element(page.getByRole('status', { name: 'Accepted import' }))
      .toHaveTextContent('run-1: queued')
    await expect.element(page.getByRole('button', { name: 'Leave source setup' })).toBeEnabled()
  })
})
