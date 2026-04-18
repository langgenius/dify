import { render } from 'vitest-browser-react'
import {
  getThresholdTone,
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterRoot,
  MeterTrack,
  MeterValue,
} from '../index'

describe('Meter', () => {
  it('exposes role="meter" with ARIA value metadata', async () => {
    const screen = await render(<Meter value={40} aria-label="Quota" />)

    await expect.element(screen.getByLabelText('Quota')).toHaveAttribute('role', 'meter')
    await expect.element(screen.getByLabelText('Quota')).toHaveAttribute('aria-valuemin', '0')
    await expect.element(screen.getByLabelText('Quota')).toHaveAttribute('aria-valuemax', '100')
    await expect.element(screen.getByLabelText('Quota')).toHaveAttribute('aria-valuenow', '40')
  })

  it('respects custom min and max', async () => {
    const screen = await render(<Meter value={3} min={1} max={5} aria-label="Quota" />)

    await expect.element(screen.getByLabelText('Quota')).toHaveAttribute('aria-valuemin', '1')
    await expect.element(screen.getByLabelText('Quota')).toHaveAttribute('aria-valuemax', '5')
    await expect.element(screen.getByLabelText('Quota')).toHaveAttribute('aria-valuenow', '3')
  })

  it('clamps non-finite value to min for ARIA', async () => {
    const screen = await render(<Meter value={Number.NaN} min={10} aria-label="Quota" />)

    await expect.element(screen.getByLabelText('Quota')).toHaveAttribute('aria-valuenow', '10')
  })

  it('applies tone class on the default indicator', async () => {
    const screen = await render(
      <Meter value={95} tone="error" aria-label="Quota" />,
    )

    const indicator = screen.container.querySelector('[data-tone], [class*="progress-error"]')
      ?? screen.container.querySelector('.bg-components-progress-error-progress')
    expect(indicator).not.toBeNull()
  })

  it('uses warning tone classes when tone="warning"', async () => {
    const screen = await render(<Meter value={85} tone="warning" aria-label="Quota" />)

    const warningFill = screen.container.querySelector(
      '.bg-components-progress-warning-progress',
    )
    expect(warningFill).not.toBeNull()
  })

  it('uses neutral tone classes by default', async () => {
    const screen = await render(<Meter value={25} aria-label="Quota" />)

    const neutralFill = screen.container.querySelector(
      '.bg-components-progress-bar-progress-solid',
    )
    expect(neutralFill).not.toBeNull()
  })

  it('supports a compound layout via MeterRoot + slots', async () => {
    const screen = await render(
      <MeterRoot value={50} aria-label="Quota">
        <MeterLabel>Storage</MeterLabel>
        <MeterTrack data-testid="custom-track">
          <MeterIndicator tone="warning" />
        </MeterTrack>
        <MeterValue />
      </MeterRoot>,
    )

    await expect.element(screen.getByTestId('custom-track')).toBeInTheDocument()
    await expect.element(screen.getByText('Storage')).toBeInTheDocument()
  })

  it('forwards className to the root element', async () => {
    const screen = await render(
      <Meter value={10} className="custom-meter" aria-label="Quota" />,
    )

    expect(screen.container.querySelector('.custom-meter')).toBeInTheDocument()
  })

  it('applies slotClassNames to track and indicator', async () => {
    const screen = await render(
      <Meter
        value={10}
        aria-label="Quota"
        slotClassNames={{ track: 'custom-track', indicator: 'custom-indicator' }}
      />,
    )

    expect(screen.container.querySelector('.custom-track')).toBeInTheDocument()
    expect(screen.container.querySelector('.custom-indicator')).toBeInTheDocument()
  })

  it('formats MeterValue via Intl options', async () => {
    const screen = await render(
      <MeterRoot
        value={0.42}
        min={0}
        max={1}
        format={{ style: 'percent', maximumFractionDigits: 0 }}
        aria-label="Score"
      >
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
        <MeterValue />
      </MeterRoot>,
    )

    await expect.element(screen.getByText('42%')).toBeInTheDocument()
  })
})

describe('getThresholdTone', () => {
  it('returns "neutral" below the warning threshold', () => {
    expect(getThresholdTone(0)).toBe('neutral')
    expect(getThresholdTone(50)).toBe('neutral')
    expect(getThresholdTone(79.99)).toBe('neutral')
  })

  it('returns "warning" at/above the warning threshold and below error', () => {
    expect(getThresholdTone(80)).toBe('warning')
    expect(getThresholdTone(99.99)).toBe('warning')
  })

  it('returns "error" at/above the error threshold', () => {
    expect(getThresholdTone(100)).toBe('error')
    expect(getThresholdTone(250)).toBe('error')
  })

  it('honors custom thresholds', () => {
    expect(getThresholdTone(55, { warningAt: 50, errorAt: 70 })).toBe('warning')
    expect(getThresholdTone(70, { warningAt: 50, errorAt: 70 })).toBe('error')
    expect(getThresholdTone(49, { warningAt: 50, errorAt: 70 })).toBe('neutral')
  })

  it('returns "neutral" for non-finite input', () => {
    expect(getThresholdTone(Number.NaN)).toBe('neutral')
    expect(getThresholdTone(Number.POSITIVE_INFINITY)).toBe('neutral')
    expect(getThresholdTone(Number.NEGATIVE_INFINITY)).toBe('neutral')
  })
})
