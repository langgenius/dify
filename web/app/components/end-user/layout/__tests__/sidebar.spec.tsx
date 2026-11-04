import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import Sidebar from '../sidebar'

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/my-apps',
}))

it('links from the end-user sidebar to the existing workspace creation page', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(new Promise<Response>(() => {}))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Sidebar />
    </QueryClientProvider>,
  )

  expect(screen.getByRole('link', { name: 'app.endUser.buildYourOwnApp' })).toHaveAttribute(
    'href',
    '/create-workspace',
  )
  expect(screen.getByRole('link', { name: 'app.endUser.myApps' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  queryClient.clear()
  vi.restoreAllMocks()
})
