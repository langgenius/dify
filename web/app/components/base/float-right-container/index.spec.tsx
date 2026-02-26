import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FloatRightContainer from './index'

describe('FloatRightContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior across mobile and desktop branches.
  describe('Rendering', () => {
    it('should render content in drawer when isMobile is true and isOpen is true', async () => {
      render(
        <FloatRightContainer
          isMobile={true}
          isOpen={true}
          onClose={vi.fn()}
          title="Mobile panel"
        >
          <div>Mobile content</div>
        </FloatRightContainer>,
      )

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Mobile panel')).toBeInTheDocument()
      expect(screen.getByText('Mobile content')).toBeInTheDocument()
    })

    it('should not render content when isMobile is true and isOpen is false', () => {
      render(
        <FloatRightContainer
          isMobile={true}
          isOpen={false}
          onClose={vi.fn()}
          unmount={true}
        >
          <div>Closed mobile content</div>
        </FloatRightContainer>,
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText('Closed mobile content')).not.toBeInTheDocument()
    })

    it('should render content inline when isMobile is false and isOpen is true', () => {
      render(
        <FloatRightContainer
          isMobile={false}
          isOpen={true}
          onClose={vi.fn()}
          title="Desktop drawer title should not render"
        >
          <div>Desktop inline content</div>
        </FloatRightContainer>,
      )

      expect(screen.getByText('Desktop inline content')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText('Desktop drawer title should not render')).not.toBeInTheDocument()
    })

    it('should render nothing when isMobile is false and isOpen is false', () => {
      const { container } = render(
        <FloatRightContainer
          isMobile={false}
          isOpen={false}
          onClose={vi.fn()}
        >
          <div>Hidden desktop content</div>
        </FloatRightContainer>,
      )

      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByText('Hidden desktop content')).not.toBeInTheDocument()
    })
  })

  // Validate that drawer-specific props are passed through in mobile mode.
  describe('Props forwarding', () => {
    it('should call onClose when close icon is clicked in mobile drawer mode', async () => {
      const onClose = vi.fn()
      render(
        <FloatRightContainer
          isMobile={true}
          isOpen={true}
          onClose={onClose}
          showClose={true}
        >
          <div>Closable mobile content</div>
        </FloatRightContainer>,
      )

      await screen.findByRole('dialog')
      const closeIcon = screen.getByTestId('close-icon')
      expect(closeIcon).toBeInTheDocument()

      await userEvent.click(closeIcon)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close is done using escape key', async () => {
      const onClose = vi.fn()
      render(
        <FloatRightContainer
          isMobile={true}
          isOpen={true}
          onClose={onClose}
          showClose={true}
        >
          <div>Closable content</div>
        </FloatRightContainer>,
      )

      const closeIcon = screen.getByTestId('close-icon')
      closeIcon.focus()
      await userEvent.keyboard('{Enter}')

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when close is done using space key', async () => {
      const onClose = vi.fn()
      render(
        <FloatRightContainer
          isMobile={true}
          isOpen={true}
          onClose={onClose}
          showClose={true}
        >
          <div>Closable content</div>
        </FloatRightContainer>,
      )

      const closeIcon = screen.getByTestId('close-icon')
      closeIcon.focus()
      await userEvent.keyboard(' ')

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should apply drawer className props in mobile drawer mode', async () => {
      render(
        <FloatRightContainer
          isMobile={true}
          isOpen={true}
          onClose={vi.fn()}
          dialogClassName="custom-dialog-class"
          panelClassName="custom-panel-class"
        >
          <div>Class forwarding content</div>
        </FloatRightContainer>,
      )

      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveClass('custom-dialog-class')

      const panel = document.querySelector('.custom-panel-class')
      expect(panel).toBeInTheDocument()
    })
  })

  // Edge-case behavior with optional children.
  describe('Edge cases', () => {
    it('should render without crashing when children is undefined in mobile mode', async () => {
      render(
        <FloatRightContainer
          isMobile={true}
          isOpen={true}
          onClose={vi.fn()}
          title="Empty mobile panel"
        >
          {undefined}
        </FloatRightContainer>,
      )

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Empty mobile panel')).toBeInTheDocument()
    })
  })
})
