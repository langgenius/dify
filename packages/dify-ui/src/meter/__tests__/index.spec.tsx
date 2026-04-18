import { render } from 'vitest-browser-react'
import {
  MeterIndicator,
  MeterLabel,
  MeterRoot,
  MeterTrack,
  MeterValue,
} from '../index'

describe('Meter compound primitives', () => {
  it('exposes role="meter" with ARIA value metadata', async () => {
    const screen = await render(
      <MeterRoot value={40} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      </MeterRoot>,
    )

    const meter = screen.getByLabelText('Quota')
    await expect.element(meter).toHaveAttribute('role', 'meter')
    await expect.element(meter).toHaveAttribute('aria-valuemin', '0')
    await expect.element(meter).toHaveAttribute('aria-valuemax', '100')
    await expect.element(meter).toHaveAttribute('aria-valuenow', '40')
  })

  it('respects custom min and max', async () => {
    const screen = await render(
      <MeterRoot value={3} min={1} max={5} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      </MeterRoot>,
    )

    const meter = screen.getByLabelText('Quota')
    await expect.element(meter).toHaveAttribute('aria-valuemin', '1')
    await expect.element(meter).toHaveAttribute('aria-valuemax', '5')
    await expect.element(meter).toHaveAttribute('aria-valuenow', '3')
  })

  it('sets indicator width from value/min/max', async () => {
    const screen = await render(
      <MeterRoot value={42} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator data-testid="indicator" />
        </MeterTrack>
      </MeterRoot>,
    )

    const indicator = screen.getByTestId('indicator').element() as HTMLElement
    expect(indicator.getAttribute('style')).toContain('width: 42%')
  })

  it('applies tone="error" to the indicator', async () => {
    const screen = await render(
      <MeterRoot value={95} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator tone="error" data-testid="indicator" />
        </MeterTrack>
      </MeterRoot>,
    )

    const indicator = screen.getByTestId('indicator').element() as HTMLElement
    expect(indicator.className).toContain('bg-components-progress-error-progress')
  })

  it('applies tone="warning" to the indicator', async () => {
    const screen = await render(
      <MeterRoot value={85} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator tone="warning" data-testid="indicator" />
        </MeterTrack>
      </MeterRoot>,
    )

    const indicator = screen.getByTestId('indicator').element() as HTMLElement
    expect(indicator.className).toContain('bg-components-progress-warning-progress')
  })

  it('defaults to the neutral tone when none is supplied', async () => {
    const screen = await render(
      <MeterRoot value={25} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator data-testid="indicator" />
        </MeterTrack>
      </MeterRoot>,
    )

    const indicator = screen.getByTestId('indicator').element() as HTMLElement
    expect(indicator.className).toContain('bg-components-progress-bar-progress-solid')
  })

  it('forwards className to MeterTrack alongside the themed base classes', async () => {
    const screen = await render(
      <MeterRoot value={10} aria-label="Quota">
        <MeterTrack className="custom-track" data-testid="track">
          <MeterIndicator />
        </MeterTrack>
      </MeterRoot>,
    )

    const track = screen.getByTestId('track').element() as HTMLElement
    expect(track.className).toContain('custom-track')
    expect(track.className).toContain('bg-components-progress-bar-bg')
  })

  it('renders MeterLabel and MeterValue inside a compound layout', async () => {
    const screen = await render(
      <MeterRoot
        value={0.42}
        min={0}
        max={1}
        format={{ style: 'percent', maximumFractionDigits: 0 }}
        aria-label="Score"
      >
        <MeterLabel>Score</MeterLabel>
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
        <MeterValue />
      </MeterRoot>,
    )

    await expect.element(screen.getByText('Score')).toBeInTheDocument()
    await expect.element(screen.getByText('42%')).toBeInTheDocument()
  })
})
