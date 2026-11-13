import type { AnnotationReplyConfig } from '@/models/debug'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  renderHookWithConsoleQuery,
  renderWithConsoleQuery,
} from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import AnnotationReply from '../index'
import useAnnotationConfig from '../use-annotation-config'

const embeddingModel = {
  embedding_provider_name: 'openai',
  embedding_model_name: 'text-embedding-3-small',
}

const annotationConfig: AnnotationReplyConfig = {
  id: 'test-setting',
  enabled: true,
  score_threshold: 0.9,
  embedding_model: embeddingModel,
}

describe('annotation reply job status', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => toast.dismiss())
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  it.each([
    ['enable', 'Vector index unavailable'],
    ['disable', 'Vector index unavailable'],
    ['enable', ''],
  ] as const)(
    'stops polling a failed %s job with error %j without changing the annotation config',
    async (action, errorMessage) => {
      let updatedConfig: AnnotationReplyConfig | undefined
      const requests: string[] = []
      let statusRequests = 0
      globalThis.fetch = async (input) => {
        const request = new Request(input)
        requests.push(`${request.method} ${new URL(request.url).pathname}`)
        if (request.method === 'POST')
          return Response.json({ job_id: 'test-job', job_status: 'waiting' })

        statusRequests += 1
        return Response.json({
          job_status: statusRequests === 1 ? 'error' : 'completed',
          error_msg: errorMessage,
        })
      }
      const { result } = renderHookWithConsoleQuery(() =>
        useAnnotationConfig({
          appId: 'test-app',
          annotationConfig: { ...annotationConfig, enabled: action === 'disable' },
          setAnnotationConfig: (config) => {
            updatedConfig = config
          },
        }),
      )

      let outcome: Promise<unknown> | undefined
      await act(async () => {
        const operation =
          action === 'enable'
            ? result.current.handleEnableAnnotation(embeddingModel)
            : result.current.handleDisableAnnotation(embeddingModel)
        outcome = operation.catch((error: unknown) => error)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })

      const expectedMessage = errorMessage || 'common.api.actionFailed'
      await expect(outcome).resolves.toEqual(new Error(expectedMessage))
      expect(updatedConfig).toBeUndefined()
      expect(requests).toEqual([
        `POST /console/api/apps/test-app/annotation-reply/${action}`,
        `GET /console/api/apps/test-app/annotation-reply/${action}/status/test-job`,
      ])
    },
  )

  it('keeps annotation enabled until the disable job completes', async () => {
    let updatedConfig: AnnotationReplyConfig | undefined
    let statusRequests = 0
    globalThis.fetch = async (input) => {
      const request = new Request(input)
      if (request.method === 'POST')
        return Response.json({ job_id: 'test-job', job_status: 'waiting' })

      statusRequests += 1
      return Response.json({ job_status: statusRequests === 1 ? 'processing' : 'completed' })
    }
    const { result } = renderHookWithConsoleQuery(() =>
      useAnnotationConfig({
        appId: 'test-app',
        annotationConfig,
        setAnnotationConfig: (config) => {
          updatedConfig = config
        },
      }),
    )

    let completion: Promise<void> | undefined
    await act(async () => {
      completion = result.current.handleDisableAnnotation(embeddingModel)
    })
    expect(statusRequests).toBe(1)
    expect(updatedConfig).toBeUndefined()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
      await completion
    })

    expect(statusRequests).toBe(2)
    expect(updatedConfig).toEqual({ ...annotationConfig, enabled: false })
  })

  it.each(['completed', 'error'])(
    'shows read-only details until the disable job reports %s',
    async (jobStatus) => {
      vi.useRealTimers()
      const user = userEvent.setup()
      let resolveJob: (response: Response) => void
      const status = new Promise<Response>((resolve) => {
        resolveJob = resolve
      })
      const actions: string[] = []
      globalThis.fetch = async (input) => {
        const request = new Request(input)
        const path = new URL(request.url).pathname
        if (path.endsWith('/default-model')) return Response.json({ data: null })
        if (path.includes('/workspaces/')) return Response.json({ data: [] })
        if (request.method === 'POST') {
          actions.push(path)
          return Response.json({ job_id: 'test-job', job_status: 'waiting' })
        }
        return status
      }
      const store = createFeaturesStore()
      store.getState().setFeatures({
        ...store.getState().features,
        annotationReply: annotationConfig,
      })
      renderWithConsoleQuery(
        <PathnameContext value="/app/test-app/configuration">
          <FeaturesContext value={store}>
            <AnnotationReply />
          </FeaturesContext>
          <AppToaster timeout={0} />
        </PathnameContext>,
      )

      const toggle = screen.getByRole('switch')
      await user.hover(toggle)
      expect(screen.getByRole('button', { name: 'common.operation.params' })).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'appDebug.feature.annotation.cacheManagement' }),
      ).toHaveAttribute('href', '/app/test-app/annotations')
      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-disabled', 'true')
      expect(toggle).toHaveAttribute('aria-busy', 'true')
      await user.unhover(toggle)
      await user.hover(toggle)
      expect(
        screen.queryByRole('button', { name: 'common.operation.params' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'appDebug.feature.annotation.cacheManagement' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('0.9')).toBeInTheDocument()
      expect(screen.getByText(embeddingModel.embedding_model_name)).toBeInTheDocument()
      await user.click(toggle)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(actions).toEqual(['/console/api/apps/test-app/annotation-reply/disable'])

      await act(async () => {
        resolveJob!(Response.json({ job_status: jobStatus, error_msg: 'Vector index unavailable' }))
      })

      expect(toggle).not.toHaveAttribute('aria-disabled', 'true')
      expect(toggle).not.toHaveAttribute('aria-busy', 'true')
      if (jobStatus === 'completed') {
        expect(toggle).not.toBeChecked()
      } else {
        expect(toggle).toBeChecked()
        expect(screen.getAllByRole('dialog', { name: 'Vector index unavailable' })).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'common.operation.params' })).not.toBeDisabled()
        expect(
          screen.getByRole('link', { name: 'appDebug.feature.annotation.cacheManagement' }),
        ).toHaveAttribute('href', '/app/test-app/annotations')
      }
    },
  )
  it.each([
    ['enable', 'POST', 'network', 'Failed to fetch'],
    ['disable', 'POST', 'network', 'Failed to fetch'],
    ['enable', 'GET', 'network', 'Failed to fetch'],
    ['disable', 'GET', 'network', 'Failed to fetch'],
    ['enable', 'POST', 'json', 'Broker unavailable'],
    ['disable', 'GET', 'proxy', 'Bad Gateway'],
    ['enable', 'GET', 'job', 'Vector index unavailable'],
  ] as const)(
    'shows one error and preserves config when %s %s fails with %s',
    async (action, failedMethod, failure, expectedMessage) => {
      vi.useRealTimers()
      const user = userEvent.setup()
      const pending = createDeferred<Response>()
      const requests: string[] = []
      globalThis.fetch = async (input) => {
        const request = new Request(input)
        const path = new URL(request.url).pathname
        requests.push(`${request.method} ${path}`)
        if (request.method === failedMethod) return pending.promise
        return Response.json({ job_id: 'test-job', job_status: 'waiting' })
      }
      const config = { ...annotationConfig, enabled: action === 'disable' }
      const store = createFeaturesStore()
      store.getState().setFeatures({ ...store.getState().features, annotationReply: config })
      const queryClient = createConsoleQueryClient()
      seedModelProviderQueries(queryClient, [
        createModelCatalogFixture({
          models: [
            createCatalogModelFixture({
              model: embeddingModel.embedding_model_name,
              model_type: 'text-embedding',
            }),
          ],
        }),
      ])
      renderWithConsoleQuery(
        <NuqsTestingAdapter>
          <PathnameContext value="/app/test-app/configuration">
            <FeaturesContext value={store}>
              <AnnotationReply />
            </FeaturesContext>
            <AppToaster timeout={0} />
          </PathnameContext>
        </NuqsTestingAdapter>,
        { queryClient },
      )

      const toggle = screen.getByRole('switch')
      await user.click(toggle)
      const control =
        action === 'enable' ? screen.getByRole('button', { name: /initSetup.confirmBtn/ }) : toggle
      if (action === 'enable') await user.click(control)
      await waitFor(() => expect(requests).toHaveLength(failedMethod === 'POST' ? 1 : 2))
      expect(control).toHaveAttribute('aria-disabled', 'true')
      if (action === 'disable') expect(control).toHaveAttribute('aria-busy', 'true')

      await act(async () => {
        if (failure === 'network') pending.reject(new TypeError(expectedMessage))
        else if (failure === 'json')
          pending.resolve(
            Response.json(
              { code: 'internal_server_error', message: expectedMessage },
              { status: 500 },
            ),
          )
        else if (failure === 'proxy')
          pending.resolve(
            new Response('<html>upstream unavailable</html>', {
              status: 502,
              statusText: expectedMessage,
              headers: { 'content-type': 'text/html' },
            }),
          )
        else pending.resolve(Response.json({ job_status: 'error', error_msg: expectedMessage }))
      })

      const toastName = failure === 'network' ? /network error/ : expectedMessage
      expect(await screen.findByRole('dialog', { name: toastName })).toBeVisible()
      expect(screen.getAllByRole('dialog', { name: toastName })).toHaveLength(1)
      expect(control).not.toHaveAttribute('aria-busy', 'true')
      expect(control).not.toHaveAttribute('aria-disabled', 'true')
      expect(store.getState().features.annotationReply).toEqual(config)
      expect(toggle).toHaveAttribute('aria-checked', String(config.enabled))
      if (action === 'enable')
        expect(screen.getByRole('dialog', { name: /initSetup.title/ })).toBeVisible()
      expect(requests).toEqual([
        `POST /console/api/apps/test-app/annotation-reply/${action}`,
        ...(failedMethod === 'GET'
          ? [`GET /console/api/apps/test-app/annotation-reply/${action}/status/test-job`]
          : []),
      ])
    },
  )
})
