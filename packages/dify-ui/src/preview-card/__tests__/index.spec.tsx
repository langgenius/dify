import { render } from 'vitest-browser-react'
import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '..'

const renderWithSafeViewport = (ui: import('react').ReactNode) => render(
  <div style={{ minHeight: '100vh', minWidth: '100vw', padding: '240px' }}>
    {ui}
  </div>,
)

describe('PreviewCardContent', () => {
  describe('Placement', () => {
    it('should use bottom placement and default offsets when placement props are not provided', async () => {
      const screen = await renderWithSafeViewport(
        <PreviewCard open>
          <PreviewCardTrigger
            render={<button type="button" aria-label="preview trigger">Open</button>}
          />
          <PreviewCardContent
            positionerProps={{ 'role': 'group', 'aria-label': 'default positioner' }}
            popupProps={{ 'role': 'dialog', 'aria-label': 'default popup' }}
          >
            <span>Default content</span>
          </PreviewCardContent>
        </PreviewCard>,
      )

      await expect.element(screen.getByRole('group', { name: 'default positioner' })).toHaveAttribute('data-side', 'bottom')
      await expect.element(screen.getByRole('group', { name: 'default positioner' })).toHaveAttribute('data-align', 'center')
      await expect.element(screen.getByRole('dialog', { name: 'default popup' })).toHaveTextContent('Default content')
    })

    it('should apply parsed custom placement and custom offsets when placement props are provided', async () => {
      const screen = await renderWithSafeViewport(
        <PreviewCard open>
          <PreviewCardTrigger
            render={<button type="button" aria-label="preview trigger">Open</button>}
          />
          <PreviewCardContent
            placement="top-end"
            sideOffset={14}
            alignOffset={6}
            positionerProps={{ 'role': 'group', 'aria-label': 'custom positioner' }}
            popupProps={{ 'role': 'dialog', 'aria-label': 'custom popup' }}
          >
            <span>Custom placement content</span>
          </PreviewCardContent>
        </PreviewCard>,
      )

      await expect.element(screen.getByRole('group', { name: 'custom positioner' })).toHaveAttribute('data-side', 'top')
      await expect.element(screen.getByRole('group', { name: 'custom positioner' })).toHaveAttribute('data-align', 'end')
      await expect.element(screen.getByRole('dialog', { name: 'custom popup' })).toHaveTextContent('Custom placement content')
    })
  })

  describe('Passthrough props', () => {
    it('should forward positionerProps and popupProps when passthrough props are provided', async () => {
      const onPopupClick = vi.fn()

      const screen = await render(
        <PreviewCard open>
          <PreviewCardTrigger
            render={<button type="button" aria-label="preview trigger">Open</button>}
          />
          <PreviewCardContent
            positionerProps={{
              'role': 'group',
              'aria-label': 'preview positioner',
              'id': 'preview-positioner-id',
            }}
            popupProps={{
              'id': 'preview-popup-id',
              'role': 'dialog',
              'aria-label': 'preview content',
              'onClick': onPopupClick,
            }}
          >
            <span>Preview body</span>
          </PreviewCardContent>
        </PreviewCard>,
      )

      const popup = screen.getByRole('dialog', { name: 'preview content' })
      await popup.click()

      await expect.element(screen.getByRole('group', { name: 'preview positioner' })).toHaveAttribute('id', 'preview-positioner-id')
      await expect.element(popup).toHaveAttribute('id', 'preview-popup-id')
      expect(onPopupClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Trigger click behavior', () => {
    it('should forward the trigger click to the consumer handler so the primary action runs', async () => {
      const onPrimaryClick = vi.fn()

      const screen = await renderWithSafeViewport(
        <PreviewCard>
          <PreviewCardTrigger
            render={(
              <button
                type="button"
                aria-label="preview trigger"
                onClick={onPrimaryClick}
              >
                Open
              </button>
            )}
          />
          <PreviewCardContent
            popupProps={{ 'role': 'dialog', 'aria-label': 'preview content' }}
          >
            <span>Preview body</span>
          </PreviewCardContent>
        </PreviewCard>,
      )

      const trigger = screen.getByRole('button', { name: 'preview trigger' })
      await trigger.click()

      expect(onPrimaryClick).toHaveBeenCalledTimes(1)
    })
  })
})
