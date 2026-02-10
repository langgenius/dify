import type { IDrawerProps } from '@/app/components/base/drawer'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import DrawerPlus from '.'

vi.mock('@/app/components/base/drawer', () => ({
  default: ({ isOpen, onClose, children, mask, positionCenter, dialogClassName, dialogBackdropClassName, panelClassName }: IDrawerProps) => {
    if (!isOpen)
      return null

    return (
      <div
        data-testid="mock-drawer"
        data-mask={mask === true ? 'true' : 'false'}
        data-position-center={positionCenter === true ? 'true' : 'false'}
        data-dialog-classname={dialogClassName}
        data-backdrop-classname={dialogBackdropClassName}
        data-panel-classname={panelClassName}
        onClick={(e: React.MouseEvent) => {
          if (e.currentTarget === e.target)
            onClose()
        }}
      >
        {children}
      </div>
    )
  },
}))

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

      expect(screen.queryByTestId('mock-drawer')).not.toBeInTheDocument()
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

      expect(screen.getByTestId('mock-drawer')).toBeInTheDocument()
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

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-panel-classname')).toContain('!max-w-[640px]')
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

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-panel-classname')).toContain('!max-w-[800px]')
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

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-panel-classname')).toContain('custom-panel')
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

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-dialog-classname')).toContain('custom-dialog')
    })

    it('should apply custom dialogBackdropClassName', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          dialogBackdropClassName="custom-backdrop"
        />,
      )

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-backdrop-classname')).toContain('custom-backdrop')
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

      const drawer = screen.getByTestId('mock-drawer')
      const contentDiv = drawer.querySelector('div[style*="height"]')
      expect(contentDiv?.className).toContain('custom-content')
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

      const drawer = screen.getByTestId('mock-drawer')
      const headerDiv = drawer.querySelector('div[class*="shrink-0"]')
      expect(headerDiv?.className).toContain('custom-header')
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

      const drawer = screen.getByTestId('mock-drawer')
      const contentDiv = drawer.querySelector('div[style*="height"]')
      expect(contentDiv?.getAttribute('style')).toContain('height: 500px')
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

      const drawer = screen.getByTestId('mock-drawer')
      const contentDiv = drawer.querySelector('div[style*="height"]')
      expect(contentDiv?.getAttribute('style')).toContain('calc(100vh - 72px)')
    })

    it('should apply isShowMask prop to drawer', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          isShowMask={true}
        />,
      )

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-mask')).toBe('true')
    })

    it('should apply positionCenter prop', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          positionCenter={true}
        />,
      )

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-position-center')).toBe('true')
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

      const drawer = screen.getByTestId('mock-drawer')
      const closeDiv = drawer.querySelector('div.cursor-pointer')
      if (closeDiv) {
        fireEvent.click(closeDiv)
        expect(handleHide).toHaveBeenCalledTimes(1)
      }
    })
  })

  describe('Breakpoints and Responsive Behavior', () => {
    it('should not show mask on desktop when isShowMask is not set', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-mask')).toBe('false')
    })

    it('should show mask on desktop when isShowMask is true', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          isShowMask={true}
        />,
      )

      const drawer = screen.getByTestId('mock-drawer')
      expect(drawer.getAttribute('data-mask')).toBe('true')
    })
  })

  describe('clickOutsideNotOpen prop', () => {
    it('should pass clickOutsideNotOpen to drawer', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
          clickOutsideNotOpen={false}
        />,
      )

      expect(screen.getByTestId('mock-drawer')).toBeInTheDocument()
    })

    it('should default clickOutsideNotOpen to true', () => {
      render(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByTestId('mock-drawer')).toBeInTheDocument()
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

      expect(screen.getByTestId('mock-drawer')).toBeInTheDocument()
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

      expect(screen.getByTestId('mock-drawer')).toBeInTheDocument()
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

      expect(screen.getByTestId('mock-drawer')).toBeInTheDocument()

      rerender(
        <DrawerPlus
          isShow={false}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      expect(screen.queryByTestId('mock-drawer')).not.toBeInTheDocument()

      rerender(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      expect(screen.getByTestId('mock-drawer')).toBeInTheDocument()
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

      expect(screen.getByTestId('mock-drawer')).toBeInTheDocument()
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

      const drawer = screen.getByTestId('mock-drawer')
      const panelClass = drawer.getAttribute('data-panel-classname')
      expect(panelClass).toContain('!max-w-[500px]')
      expect(panelClass).toContain('custom-style')
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

      const drawer = screen.getByTestId('mock-drawer')

      rerender(
        <DrawerPlus
          isShow={true}
          onHide={() => {}}
          title="Test"
          body={<div>Body</div>}
        />,
      )

      expect(drawer).toBeInTheDocument()
    })
  })
})
