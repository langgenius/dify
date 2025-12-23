import { cleanup, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '.'

const useFloatingMock = vi.fn()

vi.mock('@floating-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/react')>()
  return {
    ...actual,
    useFloating: (...args: Parameters<typeof actual.useFloating>) => {
      useFloatingMock(...args)
      return actual.useFloating(...args)
    },
  }
})

afterEach(cleanup)

describe('PortalToFollowElem', () => {
  describe('Context and Provider', () => {
    it('should throw error when using context outside provider', () => {
      // Suppress console.error for this test
      const originalError = console.error
      console.error = vi.fn()

      expect(() => {
        render(
          <PortalToFollowElemTrigger>Trigger</PortalToFollowElemTrigger>,
        )
      }).toThrow('PortalToFollowElem components must be wrapped in <PortalToFollowElem />')

      console.error = originalError
    })

    it('should not throw when used within provider', () => {
      expect(() => {
        render(
          <PortalToFollowElem>
            <PortalToFollowElemTrigger>Trigger</PortalToFollowElemTrigger>
          </PortalToFollowElem>,
        )
      }).not.toThrow()
    })
  })

  describe('PortalToFollowElemTrigger', () => {
    it('should render children correctly', () => {
      const { getByText } = render(
        <PortalToFollowElem>
          <PortalToFollowElemTrigger>Trigger Text</PortalToFollowElemTrigger>
        </PortalToFollowElem>,
      )
      expect(getByText('Trigger Text')).toBeInTheDocument()
    })

    it('should handle asChild prop correctly', () => {
      const { getByRole } = render(
        <PortalToFollowElem>
          <PortalToFollowElemTrigger asChild>
            <button>Button Trigger</button>
          </PortalToFollowElemTrigger>
        </PortalToFollowElem>,
      )

      expect(getByRole('button')).toHaveTextContent('Button Trigger')
    })
  })

  describe('PortalToFollowElemContent', () => {
    it('should not render content when closed', () => {
      const { queryByText } = render(
        <PortalToFollowElem open={false}>
          <PortalToFollowElemTrigger>Trigger</PortalToFollowElemTrigger>
          <PortalToFollowElemContent>Popup Content</PortalToFollowElemContent>
        </PortalToFollowElem>,
      )

      expect(queryByText('Popup Content')).not.toBeInTheDocument()
    })

    it('should render content when open', () => {
      const { getByText } = render(
        <PortalToFollowElem open={true}>
          <PortalToFollowElemTrigger>Trigger </PortalToFollowElemTrigger>
          <PortalToFollowElemContent>Popup Content</PortalToFollowElemContent>
        </PortalToFollowElem>,
      )

      expect(getByText('Popup Content')).toBeInTheDocument()
    })
  })

  describe('Controlled behavior', () => {
    it('should call onOpenChange when interaction happens', () => {
      const handleOpenChange = vi.fn()

      const { getByText } = render(
        <PortalToFollowElem onOpenChange={handleOpenChange}>
          <PortalToFollowElemTrigger>Hover Me</PortalToFollowElemTrigger>
          <PortalToFollowElemContent>Content</PortalToFollowElemContent>
        </PortalToFollowElem>,
      )

      fireEvent.mouseEnter(getByText('Hover Me'))
      expect(handleOpenChange).toHaveBeenCalled()

      fireEvent.mouseLeave(getByText('Hover Me'))
      expect(handleOpenChange).toHaveBeenCalled()
    })
  })

  describe('Configuration options', () => {
    it('should accept placement prop', () => {
      render(
        <PortalToFollowElem placement="top-start">
          <PortalToFollowElemTrigger>Trigger</PortalToFollowElemTrigger>
        </PortalToFollowElem>,
      )

      expect(useFloatingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          placement: 'top-start',
        }),
      )

      useFloatingMock.mockRestore()
    })
  })
})
