import { render } from 'vitest-browser-react'
import StreamdownWrapper from '../streamdown-wrapper'

// Exercise the real Streamdown renderer and its KaTeX CSS together in Chromium.
it('renders inline and display formulas with readable mathematical structure', async () => {
  const screen = await render(
    <StreamdownWrapper
      mode="static"
      latexContent={'Inline $$x^2$$ formula.\n\n$$\n\\frac{a}{b} + \\sqrt{x}\n$$'}
    />,
  )
  const formulas = screen.getByRole('math')
  await expect.element(formulas.nth(0)).toBeInTheDocument()
  await expect.element(formulas.nth(1)).toBeInTheDocument()
  const math = formulas.nth(1).element()
  expect(math.querySelector('mfrac')).not.toBeNull()
  expect(math.querySelector('msqrt')).not.toBeNull()
  expect(math.textContent).toContain('a')
  expect(math.textContent).toContain('b')
})

it('keeps invalid formulas readable and rejects executable formula links', async () => {
  const screen = await render(
    <section aria-label="Formula content">
      <StreamdownWrapper
        mode="static"
        latexContent={'$$\\unknowncommand{x}$$\n\n$$\\href{javascript:alert(1)}{unsafe}$$'}
      />
    </section>,
  )
  await expect.element(screen.getByText('\\unknowncommand{x}', { exact: false })).toBeVisible()
  const content = screen.getByRole('region', { name: 'Formula content' }).element()
  expect(content.querySelector('a[href^="javascript:"]')).toBeNull()
  expect(content.querySelector('script')).toBeNull()
})
