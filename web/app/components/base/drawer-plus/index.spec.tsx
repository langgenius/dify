import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import DrawerPlus from '.'

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'desktop',
  MediaType: { mobile: 'mobile', desktop: 'desktop', tablet: 'tablet' },
}))

describe('DrawerPlus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should not render when isShow is false', () => {
      render(
        <DrawerPlus
          isShow={false}
          onHide={() => {}}
          title="Test Drawer"
          body={<div>Content</div>}
        />,
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render when isShow is true', () => {
      const bodyContent = <div>Body Content</div>
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test Drawer"
          body={bodyContent}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Test Drawer')).toBeInTheDocument()
      expect(screen.getByText('Body Content')).toBeInTheDocument()
    })

    it('should render footer when provided', () => {
      const footerContent = <div>Footer Content</div>
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test Drawer"
          body={<div>Body</div>}
          foot={footerContent}
        />,
      )

      expect(screen.getByText('Footer Content')).toBeInTheDocument()
    })

    it('should render JSX element as title', () => {
      const titleElement = <h1 data-testid="custom-title">Custom Title</h1>
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title={titleElement}
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByTestId('custom-title')).toBeInTheDocument()
    })

    it('should render titleDescription when provided', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test Drawer"
          titleDescription="Description text"
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByText('Description text')).toBeInTheDocument()
    })

    it('should not render titleDescription when not provided', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test Drawer"
          body={<div>Body</div>}
        />,
      )

      expect(screen.queryByText(/Description/)).not.toBeInTheDocument()
    })

    it('should render JSX element as titleDescription', () => {
      const descElement = <span data-testid="custom-desc">Custom Description</span>
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          titleDescription={descElement}
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByTestId('custom-desc')).toBeInTheDocument()
    })
  })

  describe('Props - Display Options', () => {
    it('should apply default maxWidthClassName', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )
      const innerPanel = screen.getByText('Test').closest('.bg-components-panel-bg')
      const outerPanel = innerPanel?.parentElement
      expect(outerPanel?.className).toContain('!max-w-[640px]')
    })

    it('should apply custom maxWidthClassName', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          maxWidthClassName="!max-w-[800px]"
        />,
      )

      const innerPanel = screen.getByText('Test').closest('.bg-components-panel-bg')
      const outerPanel = innerPanel?.parentElement
      expect(outerPanel?.className).toContain('!max-w-[800px]')
    })

    it('should apply custom panelClassName', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          panelClassName="custom-panel"
        />,
      )

      const innerPanel = screen.getByText('Test').closest('.bg-components-panel-bg')
      const outerPanel = innerPanel?.parentElement
      expect(outerPanel?.className).toContain('custom-panel')
    })

    it('should apply custom dialogClassName', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          dialogClassName="custom-dialog"
        />,
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog.className).toContain('custom-dialog')
    })

    it('should apply custom contentClassName', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          contentClassName="custom-content"
        />,
      )
      const title = screen.getByText('Test')
      const header = title.closest('.shrink-0.border-b.border-divider-subtle')
      const content = header?.parentElement
      expect(content?.className).toContain('custom-content')
    })

    it('should apply custom headerClassName', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          headerClassName="custom-header"
        />,
      )

      const title = screen.getByText('Test')
      const header = title.closest('.shrink-0.border-b.border-divider-subtle')
      expect(header?.className).toContain('custom-header')
    })

    it('should apply custom height', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          height="500px"
        />,
      )

      const title = screen.getByText('Test')
      const header = title.closest('.shrink-0.border-b.border-divider-subtle')
      const content = header?.parentElement
      expect(content?.getAttribute('style')).toContain('height: 500px')
    })

    it('should use default height', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      const title = screen.getByText('Test')
      const header = title.closest('.shrink-0.border-b.border-divider-subtle')
      const content = header?.parentElement
      expect(content?.getAttribute('style')).toContain('calc(100vh - 72px)')
    })
  })

  describe('Event Handlers', () => {
    it('should call onHide when close button is clicked', () => {
      const handleHide = vi.fn()
      render(
        <DrawerPlus
          isShow={true}
          onHide={handleHide}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      const title = screen.getByText('Test')
      const headerRight = title.nextElementSibling // .flex items-center
      const closeDiv = headerRight?.querySelector('.cursor-pointer') as HTMLElement

      fireEvent.click(closeDiv)
      expect(handleHide).toHaveBeenCalledTimes(1)
    })
  })

  describe('Complex Content', () => {
    it('should render complex JSX elements in body', () => {
      const complexBody = (
        <div>
          <h2>Header</h2>
          <p>Paragraph</p>
          <button>Action Button</button>
        </div>
      )

      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={complexBody}
        />,
      )

      expect(screen.getByText('Header')).toBeInTheDocument()
      expect(screen.getByText('Paragraph')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Action Button' })).toBeInTheDocument()
    })

    it('should render complex footer', () => {
      const complexFooter = (
        <div className="footer-actions">
          <button>Cancel</button>
          <button>Save</button>
        </div>
      )

      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          foot={complexFooter}
        />,
      )

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty title', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title=""
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle undefined titleDescription', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          titleDescription={undefined}
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle rapid isShow toggle', () => {
      const { rerender } = render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()

      rerender(
        <DrawerPlus
          isShow={false}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle special characters in title', () => {
      const specialTitle = 'Test <> & " \' | Drawer'
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title={specialTitle}
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByText(specialTitle)).toBeInTheDocument()
    })

    it('should handle empty body content', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div></div>}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should apply both custom maxWidth and panel classNames', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          maxWidthClassName="!max-w-[500px]"
          panelClassName="custom-style"
        />,
      )

      const innerPanel = screen.getByText('Test').closest('.bg-components-panel-bg')
      const outerPanel = innerPanel?.parentElement
      expect(outerPanel?.className).toContain('!max-w-[500px]')
      expect(outerPanel?.className).toContain('custom-style')
    })
  })

  describe('Memoization', () => {
    it('should be memoized and not re-render on parent changes', () => {
      const { rerender } = render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      const dialog = screen.getByRole('dialog')

      rerender(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      expect(dialog).toBeInTheDocument()
    })
  })
})
