import { createParser } from '@openuidev/lang-core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { ANALYTICS_DEMO_CASES } from '../demo-cases'
import { GENERATIVE_UI_LIBRARY_VERSION } from '../registry/definitions'
import { difyUILibrary } from '../registry/library'
import { GenerativeUIRenderer } from '../renderer'

// Keep OpenUI parsing and Dify's chart adapter real; Browser Mode covers the rendering engine.
vi.mock('echarts-for-react/esm/core', () => ({ default: () => null }))

const dashboard = ANALYTICS_DEMO_CASES[3]

describe('Analytics response demos', () => {
  it.each(ANALYTICS_DEMO_CASES)(
    'parses the complete $id demo without missing data',
    ({ source }) => {
      const parser = createParser(difyUILibrary.toJSONSchema(), difyUILibrary.root)
      const result = parser.parse(source)

      expect(result.root).not.toBeNull()
      expect(result.meta.errors).toEqual([])
      expect(result.meta.unresolved).toEqual([])
      expect(result.meta.incomplete).toBe(false)
    },
  )

  it('renders exact dashboard values and treats lower error rates as an improvement', async () => {
    const user = userEvent.setup()
    render(
      <GenerativeUIRenderer
        source={dashboard.source}
        fallbackText={dashboard.fallbackText}
        libraryVersion={GENERATIVE_UI_LIBRARY_VERSION}
        isStreaming={false}
      />,
    )

    const sales = within(screen.getByRole('figure', { name: 'Monthly sales' }))
    expect(sales.getByText('144')).toBeVisible()
    expect(sales.getByText('+20%')).toBeVisible()
    expect(sales.getByText('vs. May')).toBeVisible()
    expect(sales.getByText('appDebug.generativeUI.metricImproved')).toBeVisible()

    const errors = within(screen.getByRole('figure', { name: 'Error rate' }))
    expect(errors.getByText('1.5')).toBeVisible()
    expect(errors.getByText('-25%')).toBeVisible()
    expect(errors.getByText('appDebug.generativeUI.metricImproved')).toBeVisible()

    const trend = within(screen.getByRole('figure', { name: 'Monthly sales trend' }))
    await user.click(trend.getByText('appDebug.generativeUI.chartData'))
    expect(trend.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
    ])
    expect(trend.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      '80 CNY 10k',
      '96 CNY 10k',
      '90 CNY 10k',
      '108 CNY 10k',
      '120 CNY 10k',
      '144 CNY 10k',
    ])

    const regions = within(screen.getByRole('figure', { name: 'June regional sales comparison' }))
    expect(regions.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'East',
      'South',
      'North',
    ])
    expect(regions.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      '72 CNY 10k',
      '48 CNY 10k',
      '24 CNY 10k',
    ])
    expect(screen.queryByText(dashboard.fallbackText)).not.toBeInTheDocument()
  })

  it('completes a streamed dashboard across partial objects, arrays, and decimal arguments', () => {
    const onCaughtError = vi.fn()
    const rendererProps = {
      libraryVersion: GENERATIVE_UI_LIBRARY_VERSION,
      fallbackText: dashboard.fallbackText,
      isStreaming: true,
    }
    const { rerender } = render(<GenerativeUIRenderer {...rendererProps} source="" />, {
      onCaughtError,
    })

    for (let length = 1; length <= dashboard.source.length; length++) {
      rerender(
        <GenerativeUIRenderer {...rendererProps} source={dashboard.source.slice(0, length)} />,
      )
    }
    rerender(
      <GenerativeUIRenderer {...rendererProps} source={dashboard.source} isStreaming={false} />,
    )

    expect(onCaughtError).not.toHaveBeenCalled()
    expect(screen.getByRole('figure', { name: 'Monthly sales trend' })).toBeVisible()
    expect(screen.getByRole('figure', { name: 'June regional sales comparison' })).toBeVisible()
    expect(
      within(screen.getByRole('figure', { name: 'Monthly sales' })).getByText('+20%'),
    ).toBeVisible()
    expect(
      within(screen.getByRole('figure', { name: 'Error rate' })).getByText('-25%'),
    ).toBeVisible()
    expect(screen.queryByText(dashboard.fallbackText)).not.toBeInTheDocument()
  })
})
