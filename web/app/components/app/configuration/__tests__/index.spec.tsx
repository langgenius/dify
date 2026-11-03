import { act, render, screen } from '@testing-library/react'
import { AppToaster } from '@/app/notifications/app-toaster'
import Configuration from '../index'
import { toast } from '../toast'

vi.mock('../configuration-view', () => ({
  default: () => <div>Configuration view</div>,
}))

vi.mock('../hooks/use-configuration', () => ({
  useConfiguration: () => ({}),
}))

describe('Configuration', () => {
  beforeEach(() => {
    toast.dismiss()
  })

  afterEach(() => {
    toast.dismiss()
  })

  it('routes configuration notifications to their own viewport', async () => {
    render(
      <>
        <AppToaster />
        <Configuration />
      </>,
    )

    act(() => {
      toast.error('Configuration error')
    })

    const toastItem = await screen.findByText('Configuration error')
    const configurationViewport = toastItem.closest<HTMLElement>('[role="region"]')
    if (!configurationViewport) throw new Error('Configuration toast viewport was not rendered')

    expect(configurationViewport).toHaveTextContent('Configuration error')

    const globalViewport = screen
      .getAllByRole('region', { name: 'Notifications' })
      .find((viewport) => viewport !== configurationViewport)
    if (!globalViewport) throw new Error('Global toast viewport was not rendered')

    expect(globalViewport).not.toHaveTextContent('Configuration error')
  })
})
