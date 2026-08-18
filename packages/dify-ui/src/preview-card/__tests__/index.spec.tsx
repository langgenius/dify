import type * as React from 'react'
import { render } from 'vitest-browser-react'
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from '..'

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

describe('PreviewCardContent', () => {
  describe('Placement', () => {
    it('should use bottom placement and default offsets when placement props are not provided', async () => {
      const screen = await renderWithSafeViewport(
        <PreviewCard open>
          <PreviewCardTrigger href="#default-preview">Open</PreviewCardTrigger>
          <PreviewCardContent
            positionerProps={{ id: 'default-positioner' }}
            popupProps={{ id: 'default-popup' }}
          >
            <span>Default content</span>
          </PreviewCardContent>
        </PreviewCard>,
      )

      await expect.element(screen.getByText('Default content')).toBeInTheDocument()
      expect(document.getElementById('default-positioner')).toHaveAttribute('data-side', 'bottom')
      expect(document.getElementById('default-positioner')).toHaveAttribute('data-align', 'center')
      expect(document.getElementById('default-popup')).toHaveTextContent('Default content')
    })

    it('should apply parsed custom placement and custom offsets when placement props are provided', async () => {
      const screen = await renderWithSafeViewport(
        <PreviewCard open>
          <PreviewCardTrigger href="#custom-preview">Open</PreviewCardTrigger>
          <PreviewCardContent
            placement="top-end"
            sideOffset={14}
            alignOffset={6}
            positionerProps={{ id: 'custom-positioner' }}
            popupProps={{ id: 'custom-popup' }}
          >
            <span>Custom placement content</span>
          </PreviewCardContent>
        </PreviewCard>,
      )

      await expect.element(screen.getByText('Custom placement content')).toBeInTheDocument()
      expect(document.getElementById('custom-positioner')).toHaveAttribute('data-side', 'top')
      expect(document.getElementById('custom-positioner')).toHaveAttribute('data-align', 'end')
      expect(document.getElementById('custom-popup')).toHaveTextContent('Custom placement content')
    })
  })

  describe('Passthrough props', () => {
    it('should forward positionerProps and popupProps when passthrough props are provided', async () => {
      const screen = await render(
        <PreviewCard open>
          <PreviewCardTrigger href="#passthrough-preview">Open</PreviewCardTrigger>
          <PreviewCardContent
            positionerProps={{
              id: 'preview-positioner-id',
            }}
            popupProps={{
              id: 'preview-popup-id',
            }}
          >
            <span>Preview body</span>
          </PreviewCardContent>
        </PreviewCard>,
      )

      await expect.element(screen.getByText('Preview body')).toBeInTheDocument()
      expect(document.getElementById('preview-positioner-id')).toBeInTheDocument()
      expect(document.getElementById('preview-popup-id')).toBeInTheDocument()
    })
  })

  describe('Trigger semantics', () => {
    it('should preserve the link destination', async () => {
      const screen = await renderWithSafeViewport(
        <PreviewCard>
          <PreviewCardTrigger href="/preview-destination">Preview destination</PreviewCardTrigger>
          <PreviewCardContent>
            <span>Preview body</span>
          </PreviewCardContent>
        </PreviewCard>,
      )

      await expect
        .element(screen.getByRole('link', { name: 'Preview destination' }))
        .toHaveAttribute('href', '/preview-destination')
    })
  })
})
