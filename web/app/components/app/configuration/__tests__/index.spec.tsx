import { ToastHost } from '@langgenius/dify-ui/toast'
import { act, render, screen } from '@testing-library/react'
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

  it('should render configuration notifications in its offset viewport', async () => {
    render(
      <>
        <ToastHost />
        <Configuration />
      </>,
    )

    act(() => {
      toast.error('Configuration error')
    })

    const toastItem = await screen.findByText('Configuration error')
    const configurationViewport = toastItem.closest<HTMLElement>('[role="region"]')
    if (!configurationViewport) throw new Error('Configuration toast viewport was not rendered')

    expect(configurationViewport).toHaveStyle({ top: '60px' })

    const globalViewport = screen
      .getAllByRole('region', { name: 'Notifications' })
      .find((viewport) => viewport !== configurationViewport)
    if (!globalViewport) throw new Error('Global toast viewport was not rendered')

    expect(globalViewport).not.toHaveTextContent('Configuration error')
  })
})
