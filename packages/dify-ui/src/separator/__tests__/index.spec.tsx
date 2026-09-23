import { render } from 'vitest-browser-react'
import { Separator } from '../index'

it('switches custom native separators between decorative and semantic modes', async () => {
  const screen = await render(<Separator decorative orientation="vertical" render={<hr />} />)

  await expect.element(screen.getByRole('separator')).not.toBeInTheDocument()
  expect(screen.container.querySelector('hr')).not.toHaveAttribute('aria-orientation')

  await screen.rerender(<Separator orientation="vertical" render={<hr />} />)

  await expect
    .element(screen.getByRole('separator'))
    .toHaveAttribute('aria-orientation', 'vertical')

  await screen.rerender(<Separator decorative render={<hr />} />)

  await expect.element(screen.getByRole('separator')).not.toBeInTheDocument()
  expect(screen.container.querySelector('hr')).not.toHaveAttribute('aria-orientation')
})
