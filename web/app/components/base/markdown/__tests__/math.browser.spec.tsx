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
  await expect.poll(() => formulas.elements().length).toBe(2)
  const math = formulas.nth(1).element()
  expect(math.querySelector('mfrac')).not.toBeNull()
  expect(math.querySelector('msqrt')).not.toBeNull()
  expect(math.textContent).toContain('a')
  expect(math.textContent).toContain('b')
  await document.fonts.ready
  const numerator = screen
    .getByText('a', { exact: true })
    .elements()
    .find((element) => element instanceof HTMLElement)
  const denominator = screen
    .getByText('b', { exact: true })
    .elements()
    .find((element) => element instanceof HTMLElement)
  if (!numerator || !denominator) throw new Error('Expected visible fraction glyphs')
  await expect.element(numerator).toBeVisible()
  await expect.element(denominator).toBeVisible()
  expect(numerator.getBoundingClientRect().bottom).toBeLessThan(
    denominator.getBoundingClientRect().top,
  )
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
  const errorText = screen
    .getByText('\\unknowncommand', { exact: true })
    .elements()
    .find((element) => element instanceof HTMLElement)
  if (!errorText) throw new Error('Expected the unsupported command to remain readable')
  await expect.element(errorText).toBeVisible()
  const content = screen.getByRole('region', { name: 'Formula content' }).element()
  expect(content.querySelector('a[href^="javascript:"]')).toBeNull()
  expect(content.querySelector('script')).toBeNull()
})
