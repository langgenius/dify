import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import SVGRenderer from '..'

const validSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" /></svg>'

// Native SVG parsing and DOMPurify must agree on namespaces and preserve renderable
// geometry while removing executable content; happy-dom does not preserve this contract.
describe('SVGRenderer', () => {
  it('renders safe SVG geometry after removing scripts and event handlers', async () => {
    const { container } = await render(
      <SVGRenderer content='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" onload="alert(1)"><script>alert(1)</script><circle cx="50" cy="50" r="40" /></svg>' />,
    )

    const circle = container.querySelector('circle')
    expect(circle).toBeInstanceOf(SVGCircleElement)
    expect(circle?.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(container.querySelector('script, [onload]')).toBeNull()
  })

  it('opens and closes a rendered SVG preview', async () => {
    const { container } = await render(<SVGRenderer content={validSvg} />)
    const circle = container.querySelector('circle')!
    await page.elementLocator(circle).click()

    await expect.element(page.getByRole('img', { name: 'Preview' })).toBeVisible()
    await expect
      .element(page.getByRole('img', { name: 'Preview' }))
      .toHaveAttribute('src', expect.stringContaining('data:image/svg+xml;base64,'))
    await page.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(page.getByRole('img', { name: 'Preview' })).not.toBeInTheDocument()
  })

  it('shows the generation fallback for invalid SVG', async () => {
    await render(<SVGRenderer content="invalid" />)
    await expect.element(page.getByText('common.svgRenderer.generatingImage')).toBeVisible()
  })
})
