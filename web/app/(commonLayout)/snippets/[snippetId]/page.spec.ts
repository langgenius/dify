import Page from './page'

const mockRedirect = vi.fn()

vi.mock('next/navigation', () => ({
  redirect: (path: string) => mockRedirect(path),
}))

describe('snippet detail redirect page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should redirect legacy snippet detail routes to orchestrate', async () => {
    await Page({
      params: Promise.resolve({ snippetId: 'snippet-1' }),
    })

    expect(mockRedirect).toHaveBeenCalledWith('/snippets/snippet-1/orchestrate')
  })
})
