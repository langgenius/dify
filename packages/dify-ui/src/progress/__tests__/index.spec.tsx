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
    const screen = await render(<ProgressCircle value={3} min={1} max={5} aria-label="Installing" />)

    const progress = screen.getByLabelText('Installing')

    await expect.element(progress).toHaveAttribute('aria-valuemin', '1')
    await expect.element(progress).toHaveAttribute('aria-valuemax', '5')
    await expect.element(progress).toHaveAttribute('aria-valuenow', '3')
  })

  it('renders indeterminate state when value is null', async () => {
    const screen = await render(<ProgressCircle value={null} aria-label="Processing" data-testid="progress" />)

    await expect.element(screen.getByTestId('progress')).toHaveAttribute('data-indeterminate')
    await expect.element(screen.getByTestId('progress')).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByTestId('progress').element().querySelector('path')).toBeNull()
  })

  it('does not render a progress sector for zero progress', async () => {
    const screen = await render(<ProgressCircle value={0} aria-label="Uploading" data-testid="progress" />)

    expect(screen.getByTestId('progress').element().querySelector('path')).toBeNull()
  })

  it('renders a deterministic progress sector', async () => {
    const screen = await render(<ProgressCircle value={75} aria-label="Uploading" data-testid="progress" />)

    const path = screen.getByTestId('progress').element().querySelector('path')!

    expect(path.getAttribute('d')).toContain('A 6,6 0 1 1')
  })

  it('renders a closed circle sector for complete progress', async () => {
    const screen = await render(<ProgressCircle value={100} aria-label="Uploading" data-testid="progress" />)

    const path = screen.getByTestId('progress').element().querySelector('path')!
    const pathData = path.getAttribute('d')!

    expect(pathData).toContain('A 6,6 0 1 1 6,12')
    expect(pathData).toContain('A 6,6 0 1 1 6,0')
  })
})
