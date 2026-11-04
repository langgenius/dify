import { render } from 'vitest-browser-react'
import { ProgressCircle } from '../index'

describe('ProgressCircle', () => {
  it('exposes progressbar semantics through Base UI Progress', async () => {
    const screen = await render(<ProgressCircle value={40} aria-label="Uploading" />)

    const progress = screen.getByLabelText('Uploading')

    await expect.element(progress).toHaveAttribute('role', 'progressbar')
    await expect.element(progress).toHaveAttribute('aria-valuemin', '0')
    await expect.element(progress).toHaveAttribute('aria-valuemax', '100')
    await expect.element(progress).toHaveAttribute('aria-valuenow', '40')
  })

  it('supports custom min and max', async () => {
    const screen = await render(
      <ProgressCircle value={3} min={1} max={5} aria-label="Installing" />,
    )

    const progress = screen.getByLabelText('Installing')

    await expect.element(progress).toHaveAttribute('aria-valuemin', '1')
    await expect.element(progress).toHaveAttribute('aria-valuemax', '5')
    await expect.element(progress).toHaveAttribute('aria-valuenow', '3')
  })

  it('renders indeterminate state when value is null', async () => {
    const screen = await render(<ProgressCircle value={null} aria-label="Processing" />)
    const progress = screen.getByLabelText('Processing')

    await expect.element(progress).toHaveAttribute('role', 'progressbar')
    await expect.element(progress).toHaveAttribute('data-indeterminate')
    await expect.element(progress).not.toHaveAttribute('aria-valuenow')
  })
})
