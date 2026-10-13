import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import Annotation from '../index'

it('stops a failed disable job without refreshing annotation settings as successful', async () => {
  const originalFetch = globalThis.fetch
  let settingsRequests = 0
  let statusRequests = 0
  let resolveStatus: (response: Response) => void
  const status = new Promise<Response>((resolve) => {
    resolveStatus = resolve
  })
  globalThis.fetch = async (input) => {
    const request = new Request(input)
    const path = new URL(request.url).pathname
    if (path.endsWith('/annotation-setting')) {
      settingsRequests += 1
      return Response.json({
        id: 'test-setting',
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-3-small',
        },
      })
    }
    if (path.endsWith('/annotations/count')) return Response.json({ count: 0 })
    if (path.endsWith('/annotations') || path.endsWith('/annotations/export'))
      return Response.json({ data: [], total: 0 })
    if (request.method === 'POST')
      return Response.json({ job_id: 'test-job', job_status: 'waiting' })
    if (path.endsWith('/status/test-job')) {
      statusRequests += 1
      return statusRequests === 1 ? status : Response.json({ job_status: 'completed' })
    }
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  }

  try {
    renderWithConsoleQuery(
      <>
        <Annotation
          appDetail={createAppDetailFixture({ id: 'test-app', mode: AppModeEnum.CHAT })}
        />
        <AppToastHost timeout={0} />
      </>,
    )
    const toggle = await screen.findByRole('switch')
    await waitFor(() => expect(toggle).toBeChecked())
    const user = userEvent.setup()
    await user.click(toggle)
    vi.useFakeTimers()
    await act(async () => {
      resolveStatus!(Response.json({ job_status: 'error', error_msg: 'Vector index unavailable' }))
      await vi.advanceTimersByTimeAsync(4000)
    })

    expect(statusRequests).toBe(1)
    expect(settingsRequests).toBe(1)
    expect(toggle).toBeChecked()
    expect(screen.getAllByRole('dialog', { name: 'Vector index unavailable' })).toHaveLength(1)
  } finally {
    act(() => toast.dismiss())
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  }
})
