import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CustomDialog from './index'

describe('CustomDialog Component', () => {
  const setup = () => userEvent.setup()

  it('should render children and title when show is true', async () => {
    render(
      <CustomDialog show={true} title="Modal Title">
        <div data-testid="dialog-content">Main Content</div>
      </CustomDialog>,
    )

    const title = await screen.findByText('Modal Title')
    const content = screen.getByTestId('dialog-content')

    expect(title).toBeInTheDocument()
    expect(content).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('should not render anything when show is false', async () => {
    render(
      <CustomDialog show={false} title="Hidden Title">
        <div>Content</div>
      </CustomDialog>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden Title')).not.toBeInTheDocument()
  })

  it('should apply the correct semantic tag to title using titleAs', async () => {
    render(
      <CustomDialog show={true} title="Semantic Title" titleAs="h1">
        Content
      </CustomDialog>,
    )

    const title = await screen.findByRole('heading', { level: 1 })
    expect(title).toHaveTextContent('Semantic Title')
  })

  it('should render the footer only when the prop is provided', async () => {
    const { rerender } = render(
      <CustomDialog show={true}>Content</CustomDialog>,
    )

    await screen.findByRole('dialog')
    expect(screen.queryByText('Footer Content')).not.toBeInTheDocument()

    rerender(
      <CustomDialog show={true} footer={<div data-testid="footer-node">Footer Content</div>}>
        Content
      </CustomDialog>,
    )

    expect(await screen.findByTestId('footer-node')).toBeInTheDocument()
  })

  it('should call onClose when Escape key is pressed', async () => {
    const user = setup()
    const onCloseMock = vi.fn()

    render(
      <CustomDialog show={true} onClose={onCloseMock}>
        Content
      </CustomDialog>,
    )

    await screen.findByRole('dialog')

    await act(async () => {
      await user.keyboard('{Escape}')
    })

    expect(onCloseMock).toHaveBeenCalledTimes(1)
  })

  it('should call onClose when the backdrop is clicked', async () => {
    const user = setup()
    const onCloseMock = vi.fn()

    render(
      <CustomDialog show={true} onClose={onCloseMock}>
        Content
      </CustomDialog>,
    )

    await screen.findByRole('dialog')

    const backdrop = document.querySelector('.bg-background-overlay-backdrop')
    expect(backdrop).toBeInTheDocument()

    await act(async () => {
      await user.click(backdrop!)
    })

    expect(onCloseMock).toHaveBeenCalledTimes(1)
  })

  it('should apply custom class names to internal elements', async () => {
    render(
      <CustomDialog
        show={true}
        title="Title"
        className="custom-panel-container"
        titleClassName="custom-title-style"
        bodyClassName="custom-body-style"
        footer="Footer"
        footerClassName="custom-footer-style"
      >
        <div data-testid="content">Content</div>
      </CustomDialog>,
    )

    await screen.findByRole('dialog')

    expect(document.querySelector('.custom-panel-container')).toBeInTheDocument()
    expect(document.querySelector('.custom-title-style')).toBeInTheDocument()
    expect(document.querySelector('.custom-body-style')).toBeInTheDocument()
    expect(document.querySelector('.custom-footer-style')).toBeInTheDocument()
  })

  it('should maintain accessibility attributes (aria-modal)', async () => {
    render(
      <CustomDialog show={true} title="Accessibility Test">
        <button>Focusable Item</button>
      </CustomDialog>,
    )

    const dialog = await screen.findByRole('dialog')
    // Headless UI should automatically set aria-modal="true"
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})
