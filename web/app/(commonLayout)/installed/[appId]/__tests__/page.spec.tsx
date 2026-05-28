import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InstalledApp from '../page'

vi.mock('@/app/components/explore/installed-app', () => ({
  default: ({ id }: { id: string }) => (
    <div data-testid="installed-app-page">
      {id}
    </div>
  ),
}))

describe('installed app route', () => {
  it('should render the installed app page with the route app id', async () => {
    const page = await InstalledApp({
      params: Promise.resolve({ appId: 'installed-1' }),
    })

    render(page)

    expect(screen.getByTestId('installed-app-page')).toHaveTextContent('installed-1')
  })
})
