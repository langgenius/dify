import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import GithubStar from './index'

const GITHUB_URL = 'https://api.github.com/repos/langgenius/dify'

const server = setupServer(
  http.get(GITHUB_URL, () => HttpResponse.json({ stargazers_count: 123456 })),
)

const renderWithQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <GithubStar className='test-class' />
    </QueryClientProvider>,
  )
  return { queryClient, ...utils }
}

describe('GithubStar', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => {
    server.resetHandlers()
  })
  afterAll(() => server.close())

  // Shows fetched star count when request succeeds
  it('should render fetched star count', async () => {
    renderWithQueryClient()

    expect(await screen.findByText('123,456')).toBeInTheDocument()
  })

  // Falls back to default star count when request fails
  it('should render default star count on error', async () => {
    server.use(http.get(GITHUB_URL, () => HttpResponse.json({}, { status: 500 })))

    renderWithQueryClient()

    expect(await screen.findByText('110,918')).toBeInTheDocument()
  })

  // Renders loader while fetching data
  it('should show loader while fetching', async () => {
    server.use(
      http.get(GITHUB_URL, async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return HttpResponse.json({ stargazers_count: 222222 })
      }),
    )

    const { container } = renderWithQueryClient()

    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('222,222')).toBeInTheDocument())
  })
})
