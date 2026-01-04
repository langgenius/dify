import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import nock from 'nock'
import * as React from 'react'
import GithubStar from './index'

const GITHUB_HOST = 'https://api.github.com'
const GITHUB_PATH = '/repos/langgenius/dify'

const renderWithQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <GithubStar className="test-class" />
    </QueryClientProvider>,
  )
}

const mockGithubStar = (status: number, body: Record<string, unknown>, delayMs = 0) => {
  return nock(GITHUB_HOST).get(GITHUB_PATH).delay(delayMs).reply(status, body)
}

describe('GithubStar', () => {
  beforeEach(() => {
    nock.cleanAll()
  })

  // Shows fetched star count when request succeeds
  it('should render fetched star count', async () => {
    mockGithubStar(200, { stargazers_count: 123456 })

    renderWithQueryClient()

    expect(await screen.findByText('123,456')).toBeInTheDocument()
  })

  // Falls back to default star count when request fails
  it('should render default star count on error', async () => {
    mockGithubStar(500, {})

    renderWithQueryClient()

    expect(await screen.findByText('110,918')).toBeInTheDocument()
  })

  // Renders loader while fetching data
  it('should show loader while fetching', async () => {
    mockGithubStar(200, { stargazers_count: 222222 }, 50)

    const { container } = renderWithQueryClient()

    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('222,222')).toBeInTheDocument())
  })
})
