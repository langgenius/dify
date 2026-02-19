import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContentDialog from './index'

describe('ContentDialog', () => {
  it('renders children when show is true', async () => {
    render(
      <ContentDialog show={true}>
        <div>Dialog body</div>
      </ContentDialog>,
    )

    await screen.findByText('Dialog body')
    expect(screen.getByText('Dialog body')).toBeInTheDocument()

    const backdrop = document.querySelector('.bg-app-detail-overlay-bg')
    expect(backdrop).toBeTruthy()
  })

  it('does not render children when show is false', () => {
    render(
      <ContentDialog show={false}>
        <div>Hidden content</div>
      </ContentDialog>,
    )

    expect(screen.queryByText('Hidden content')).toBeNull()
    expect(document.querySelector('.bg-app-detail-overlay-bg')).toBeNull()
  })

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn()
    render(
      <ContentDialog show={true} onClose={onClose}>
        <div>Body</div>
      </ContentDialog>,
    )

    const user = userEvent.setup()
    const backdrop = document.querySelector('.bg-app-detail-overlay-bg') as HTMLElement | null
    expect(backdrop).toBeTruthy()

    await user.click(backdrop!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('applies provided className to the content panel', () => {
    render(
      <ContentDialog show={true} className="my-panel-class">
        <div>Panel content</div>
      </ContentDialog>,
    )

    const contentPanel = document.querySelector('.bg-app-detail-bg') as HTMLElement | null
    expect(contentPanel).toBeTruthy()
    expect(contentPanel?.className).toContain('my-panel-class')
    expect(screen.getByText('Panel content')).toBeInTheDocument()
  })
})
