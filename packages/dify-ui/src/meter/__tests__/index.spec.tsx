import { render } from 'vitest-browser-react'
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from '../index'

describe('Meter compound primitives', () => {
  it('exposes role="meter" with ARIA value metadata', async () => {
    const screen = await render(
      <Meter value={40} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      </Meter>,
    )

    const meter = screen.getByLabelText('Quota')
    await expect.element(meter).toHaveAttribute('role', 'meter')
    await expect.element(meter).toHaveAttribute('aria-valuemin', '0')
    await expect.element(meter).toHaveAttribute('aria-valuemax', '100')
    await expect.element(meter).toHaveAttribute('aria-valuenow', '40')
  })

  it('respects custom min and max', async () => {
    const screen = await render(
      <Meter value={3} min={1} max={5} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      </Meter>,
    )

    const meter = screen.getByLabelText('Quota')
    await expect.element(meter).toHaveAttribute('aria-valuemin', '1')
    await expect.element(meter).toHaveAttribute('aria-valuemax', '5')
    await expect.element(meter).toHaveAttribute('aria-valuenow', '3')
  })

  it('sets indicator width from value/min/max', async () => {
    const screen = await render(
      <Meter value={42} aria-label="Quota">
        <MeterTrack>
          <MeterIndicator data-testid="indicator" />
        </MeterTrack>
      </Meter>,
    )

    const indicator = screen.getByTestId('indicator').element() as HTMLElement
    expect(indicator.getAttribute('style')).toContain('width: 42%')
  })

  it('forwards className to MeterTrack', async () => {
    const screen = await render(
      <Meter value={10} aria-label="Quota">
        <MeterTrack className="custom-track" data-testid="track">
          <MeterIndicator />
        </MeterTrack>
      </Meter>,
    )

    const track = screen.getByTestId('track').element() as HTMLElement
    expect(track.className).toContain('custom-track')
  })

  it('renders MeterLabel and MeterValue inside a compound layout', async () => {
    const screen = await render(
      <Meter
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
      </Meter>,
    )

    await expect.element(screen.getByText('Score')).toBeInTheDocument()
    await expect.element(screen.getByText('42%')).toBeInTheDocument()
  })
})
