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

  it('applies design kit size variants', async () => {
    const screen = await render(<ProgressCircle value={50} size="large" aria-label="Uploading" data-testid="progress" />)

    const root = screen.getByTestId('progress').element() as HTMLElement
    const svg = root.querySelector('svg')!

    expect(root.className).toContain('size-5')
    expect(svg.getAttribute('width')).toBe('21')
    expect(svg.getAttribute('height')).toBe('21')
  })

  it('applies color tokens to circle and sector', async () => {
    const screen = await render(<ProgressCircle value={50} color="error" aria-label="Uploading" data-testid="progress" />)

    const root = screen.getByTestId('progress').element() as HTMLElement
    const circle = root.querySelector('circle')!
    const path = root.querySelector('path')!

    expect(circle.getAttribute('class')).toContain('fill-components-progress-error-bg')
    expect(circle.getAttribute('class')).toContain('stroke-components-progress-error-border')
    expect(path.getAttribute('class')).toContain('fill-components-progress-error-progress')
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
