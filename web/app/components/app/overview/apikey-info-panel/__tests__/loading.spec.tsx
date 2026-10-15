import { act, screen, waitFor } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import APIKeyInfoPanel from '../index'

const { request } = vi.hoisted(() => ({ request: vi.fn<() => Promise<Response>>() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))
vi.mock('nuqs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuqs')>()),
  useQueryState: () => [null, vi.fn()],
}))

it('waits for confirmed model availability before showing setup guidance without a trial claim', async () => {
  let resolveRequest!: (response: Response) => void
  request.mockReturnValue(
    new Promise<Response>((resolve) => {
      resolveRequest = resolve
    }),
  )
  renderWithConsoleQuery(<APIKeyInfoPanel />, { systemFeatures: { deployment_edition: 'CLOUD' } })
  expect(
    screen.queryByRole('button', { name: 'appOverview.apiKeyInfo.setAPIBtn' }),
  ).not.toBeInTheDocument()
  await act(async () => {
    resolveRequest(Response.json({ data: [] }))
  })
  expect(
    await screen.findByRole('button', { name: 'appOverview.apiKeyInfo.setAPIBtn' }),
  ).toBeInTheDocument()
  expect(screen.getByText('appOverview.apiKeyInfo.selfHost.title.row2')).toBeInTheDocument()
  expect(screen.queryByText(/appOverview.apiKeyInfo.cloud.trial/)).not.toBeInTheDocument()
})

it('does not interpret a failed model request as a missing provider', async () => {
  request.mockRejectedValue(new Error('Models unavailable'))
  const { queryClient } = renderWithConsoleQuery(<APIKeyInfoPanel />)
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(
    screen.queryByRole('button', { name: 'appOverview.apiKeyInfo.setAPIBtn' }),
  ).not.toBeInTheDocument()
})
