import { cn } from '@langgenius/dify-ui/cn'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MAIN_NAV_LAYOUT_CLASS_NAME } from '../responsive-classes'

function DetailSidebarLayoutHarness() {
  return (
    <section
      aria-label="Detail page shell"
      className={cn(MAIN_NAV_LAYOUT_CLASS_NAME, 'h-dvh w-full flex-row')}
    >
      <aside aria-label="Detail navigation" className="h-full w-62 shrink-0" />
      <main className="flex min-h-0 min-w-0 grow flex-col overflow-hidden">
        <h1>Detail content</h1>
      </main>
    </section>
  )
}

describe('Main navigation detail layout', () => {
  afterEach(async () => {
    await page.viewport(1280, 720)
  })

  it('keeps detail content visible beside the full-height sidebar at 320 CSS pixels', async () => {
    // Chromium owns responsive flex geometry; happy-dom cannot prove the main region keeps height.
    await page.viewport(320, 800)
    const screen = await render(<DetailSidebarLayoutHarness />)
    const shell = screen.getByRole('region', { name: 'Detail page shell' }).element()
    const main = screen.getByRole('main').element()

    await expect.element(screen.getByRole('heading', { name: 'Detail content' })).toBeVisible()
    expect(main.getBoundingClientRect().height).toBe(shell.getBoundingClientRect().height)
    expect(main.getBoundingClientRect().width).toBeGreaterThan(0)
  })
})
