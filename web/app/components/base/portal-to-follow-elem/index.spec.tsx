import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '.'

afterEach(cleanup)

describe('PortalToFollowElem', () => {
  describe('Context and Provider', () => {
    test('should throw error when using context outside provider', () => {
      // Suppress console.error for this test
      const originalError = console.error
      console.error = jest.fn()

      expect(() => {
        render(
          <PortalToFollowElemTrigger>Trigger</PortalToFollowElemTrigger>,
        )
      }).toThrow('PortalToFollowElem components must be wrapped in <PortalToFollowElem />')

      console.error = originalError
    })

    test('should not throw when used within provider', () => {
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
    test('should render children correctly', () => {
      const { getByText } = render(
        <PortalToFollowElem>
          <PortalToFollowElemTrigger>Trigger Text</PortalToFollowElemTrigger>
        </PortalToFollowElem>,
      )
      expect(getByText('Trigger Text')).toBeInTheDocument()
    })

    test('should handle asChild prop correctly', () => {
      const { getByRole } = render(
        <PortalToFollowElem>
          <PortalToFollowElemTrigger asChild >
            <button>Button Trigger</button>
          </PortalToFollowElemTrigger>
        </PortalToFollowElem>,
      )

      expect(getByRole('button')).toHaveTextContent('Button Trigger')
    })
  })

  describe('PortalToFollowElemContent', () => {
    test('should not render content when closed', () => {
      const { queryByText } = render(
        <PortalToFollowElem open={false} >
          <PortalToFollowElemTrigger>Trigger</PortalToFollowElemTrigger>
          <PortalToFollowElemContent>Popup Content</PortalToFollowElemContent>
        </PortalToFollowElem>,
      )

      expect(queryByText('Popup Content')).not.toBeInTheDocument()
    })

    test('should render content when open', () => {
      const { getByText } = render(
        <PortalToFollowElem open={true} >
          <PortalToFollowElemTrigger>Trigger </PortalToFollowElemTrigger>
          <PortalToFollowElemContent>Popup Content</PortalToFollowElemContent>
        </PortalToFollowElem>,
      )

      expect(getByText('Popup Content')).toBeInTheDocument()
    })
  })

  describe('Controlled behavior', () => {
    test('should call onOpenChange when interaction happens', () => {
      const handleOpenChange = jest.fn()

      const { getByText } = render(
        <PortalToFollowElem onOpenChange={handleOpenChange} >
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
    test('should accept placement prop', () => {
      // Since we can't easily test actual positioning, we'll check if the prop is passed correctly
      const useFloatingMock = jest.spyOn(require('@floating-ui/react'), 'useFloating')

      render(
        <PortalToFollowElem placement='top-start' >
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
