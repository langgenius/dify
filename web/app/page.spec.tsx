import { redirect } from 'next/navigation'
import Home from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('Home page redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should redirect to /apps when search params are empty', async () => {
    // Arrange
    const props = {
      searchParams: Promise.resolve({}),
    }

    // Act
    await Home(props)

    // Assert
    expect(redirect).toHaveBeenCalledWith('/apps')
  })

  it('should preserve single query param when redirecting to /apps', async () => {
    // Arrange
    const props = {
      searchParams: Promise.resolve({
        oauth_redirect_url: 'https://example.com/callback',
      }),
    }

    // Act
    await Home(props)

    // Assert
    expect(redirect).toHaveBeenCalledWith('/apps?oauth_redirect_url=https%3A%2F%2Fexample.com%2Fcallback')
  })

  it('should preserve repeated query params when redirecting to /apps', async () => {
    // Arrange
    const props = {
      searchParams: Promise.resolve({
        scope: ['read:name', 'read:email'],
      }),
    }

    // Act
    await Home(props)

    // Assert
    expect(redirect).toHaveBeenCalledWith('/apps?scope=read%3Aname&scope=read%3Aemail')
  })

  it('should ignore undefined query values when building redirect url', async () => {
    // Arrange
    const props = {
      searchParams: Promise.resolve({
        client_id: 'abc',
        state: undefined,
      }),
    }

    // Act
    await Home(props)

    // Assert
    expect(redirect).toHaveBeenCalledWith('/apps?client_id=abc')
  })
})
