import { render, screen } from '@testing-library/react'
import AccessConfig from '../page'

vi.mock('@/app/components/app/access-config', () => ({
  default: ({ appId }: { appId: string }) => (
    <div data-testid="app-access-config" data-app-id={appId}>
      app access config
      {appId}
    </div>
  ),
}))

describe('App access config route', () => {
  // Route rendering resolves the async app id params for the client page.
  describe('Rendering', () => {
    it('should pass app id from route params', async () => {
      render(
        await AccessConfig({
          params: Promise.resolve({ locale: 'en-US', appId: 'app-route-id' }),
        }),
      )

      expect(screen.getByTestId('app-access-config')).toHaveAttribute('data-app-id', 'app-route-id')
    })
  })
})
