import * as React from 'react'
import { render } from 'vitest-browser-react'
import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardPopup,
  PreviewCardPortal,
  PreviewCardPositioner,
  PreviewCardTrigger,
} from '..'

const renderWithSafeViewport = (ui: React.ReactNode) =>
  render(<div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>{ui}</div>)

describe('PreviewCardContent', () => {
  describe('Placement', () => {
    it('should use bottom placement and default offsets when placement props are not provided', async () => {
      const screen = await renderWithSafeViewport(
        <PreviewCard open>
          <PreviewCardTrigger href="#default-preview">Open</PreviewCardTrigger>
          <PreviewCardContent>Default content</PreviewCardContent>
        </PreviewCard>,
      )

      await expect
        .element(screen.getByText('Default content'))
        .toHaveAttribute('data-side', 'bottom')
      await expect
        .element(screen.getByText('Default content'))
        .toHaveAttribute('data-align', 'center')
    })

    it('should apply parsed custom placement and custom offsets when placement props are provided', async () => {
      const screen = await renderWithSafeViewport(
        <PreviewCard open>
          <PreviewCardTrigger href="#custom-preview">Open</PreviewCardTrigger>
          <PreviewCardContent placement="top-end" sideOffset={14} alignOffset={6}>
            Custom placement content
          </PreviewCardContent>
        </PreviewCard>,
      )

      await expect
        .element(screen.getByText('Custom placement content'))
        .toHaveAttribute('data-side', 'top')
      await expect
        .element(screen.getByText('Custom placement content'))
        .toHaveAttribute('data-align', 'end')
    })
  })

  describe('Surface', () => {
    it('should provide the default preview card surface', async () => {
      const screen = await renderWithSafeViewport(
        <PreviewCard open>
          <PreviewCardTrigger href="#default-surface">Open</PreviewCardTrigger>
          <PreviewCardContent>Default surface</PreviewCardContent>
        </PreviewCard>,
      )

      const popupStyle = getComputedStyle(screen.getByText('Default surface').element())
      expect(popupStyle.borderTopWidth).not.toBe('0px')
      expect(popupStyle.borderTopLeftRadius).not.toBe('0px')
      expect(popupStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(popupStyle.boxShadow).not.toBe('none')
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

describe('PreviewCard anatomy', () => {
  it('should compose an unstyled popup with explicit positioning', async () => {
    const screen = await renderWithSafeViewport(
      <PreviewCard open>
        <PreviewCardTrigger href="#anatomy-preview">Open</PreviewCardTrigger>
        <PreviewCardPortal>
          <PreviewCardPositioner placement="top-end" data-testid="preview-positioner">
            <PreviewCardPopup>Anatomy surface</PreviewCardPopup>
          </PreviewCardPositioner>
        </PreviewCardPortal>
      </PreviewCard>,
    )

    await expect
      .element(screen.getByTestId('preview-positioner'))
      .toHaveAttribute('data-side', 'top')
    await expect
      .element(screen.getByTestId('preview-positioner'))
      .toHaveAttribute('data-align', 'end')
    const popupStyle = getComputedStyle(screen.getByText('Anatomy surface').element())
    expect(popupStyle.borderTopWidth).toBe('0px')
    expect(popupStyle.borderTopLeftRadius).toBe('0px')
    expect(popupStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(popupStyle.boxShadow).toBe('none')
  })
})
