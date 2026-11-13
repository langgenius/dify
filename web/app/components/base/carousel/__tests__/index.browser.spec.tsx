import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Carousel } from '../index'

it.each(['horizontal', 'vertical'] as const)(
  'moves the visible %s slide and keeps navigation in sync with the actual position',
  async (orientation) => {
    await page.viewport(1000, 800)
    const vertical = orientation === 'vertical'
    const screen = await render(
      <Carousel
        aria-label="Featured apps"
        orientation={orientation}
        style={{ width: 360, height: vertical ? 180 : undefined }}
      >
        <Carousel.Content style={{ height: vertical ? '100%' : undefined }}>
          {[1, 2, 3].map((number) => (
            <Carousel.Item key={number} aria-label={`Slide ${number}`} style={{ height: 180 }}>
              Featured app {number}
            </Carousel.Item>
          ))}
        </Carousel.Content>
        <div style={{ position: 'fixed', top: 250, left: 20 }}>
          <Carousel.Previous>Previous app</Carousel.Previous>
          <Carousel.Next>Next app</Carousel.Next>
          <Carousel.Dot>Choose app</Carousel.Dot>
        </div>
      </Carousel>,
    )
    const carousel = screen.getByRole('region', { name: 'Featured apps' })
    const previous = screen.getByRole('button', { name: 'Previous app' })
    const next = screen.getByRole('button', { name: 'Next app' })
    const dots = screen.getByRole('button', { name: 'Choose app' })
    const slide = (number: number) => screen.getByRole('group', { name: `Slide ${number}` })
    const expectAligned = async (number: number) => {
      await expect.element(slide(number)).toBeVisible()
      await expect
        .poll(() => {
          const frame = carousel.element().getBoundingClientRect()
          const bounds = slide(number).element().getBoundingClientRect()
          return Math.abs(vertical ? bounds.top - frame.top : bounds.left - frame.left)
        })
        .toBeLessThan(1)
      await expect.element(dots.nth(number - 1)).toHaveAttribute('data-state', 'active')
    }

    await expect.element(previous).toBeDisabled()
    await expect.element(next).toBeEnabled()
    await expectAligned(1)
    await next.click()
    await expectAligned(2)
    await expect.element(previous).toBeEnabled()
    await dots.nth(2).click()
    await expectAligned(3)
    await expect.element(next).toBeDisabled()
    await previous.click()
    await expectAligned(2)
    await expect.element(next).toBeEnabled()
  },
)
