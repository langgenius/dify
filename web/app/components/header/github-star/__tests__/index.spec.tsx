import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { onTestFinished } from 'vite-plus/test'
import GithubStar from '../index'

const renderStars = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onTestFinished(() => client.clear())
  return render(
    <QueryClientProvider client={client}>
      <GithubStar className="" />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

it('shows the fetched star count after the request completes', async () => {
  let resolve!: (response: Response) => void
  const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  renderStars()
  expect(screen.queryByText(/^[\d,]+$/)).not.toBeInTheDocument()

  resolve(Response.json({ repo: { stars: 123456 } }))

  expect(await screen.findByText('123,456')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('https://ungh.cc/repos/langgenius/dify')
})

it('keeps a numeric fallback visible when the star request fails', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))
  renderStars()
  expect(await screen.findByText(/^[\d,]+$/)).toBeInTheDocument()
})
