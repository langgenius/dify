import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { GENERATIVE_UI_LIBRARY_VERSION } from '../registry/definitions'
import { GenerativeUIRenderer } from '../renderer'

const salesSource = `root = Stack([summary, detail, filterPanel])
summary = Card("Total sales", [totalSales, totalOrders])
totalSales = Heading("260 CNY 10k", "section")
totalOrders = Text("Total orders: 65")
detail = Card("Regional sales details", [salesTable])
salesTable = Table("Regional sales data", ["Region", "Sales", "Orders"], [["East", "120 CNY 10k", "30 orders"], ["South", "80 CNY 10k", "20 orders"], ["North", "60 CNY 10k", "15 orders"]])
filterPanel = Card("Filters", [filterForm])
filterForm = Form("salesFilter", "Filter sales", "Apply filters", "Filter sales using my submitted region and note, then return the updated interface.", [regionField, noteField])
regionField = SelectField("region", "Region", ["All", "East", "South", "North"], "All", false)
noteField = TextField("note", "Note", "", false)`

const fallbackText = 'Total sales were CNY 2,600,000 across 65 orders.'

describe('Sales response generative UI', () => {
  it('renders the generated sales summary, table, and nested filter form', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(
      <GenerativeUIRenderer
        source={salesSource}
        libraryVersion={GENERATIVE_UI_LIBRARY_VERSION}
        isStreaming={false}
        fallbackText={fallbackText}
        onAction={onAction}
      />,
    )

    expect(screen.getByRole('heading', { name: '260 CNY 10k' })).toBeVisible()
    expect(screen.getByText('Total orders: 65')).toBeVisible()
    const table = screen.getByRole('table', { name: 'Regional sales data' })
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'East',
      '120 CNY 10k',
      '30 orders',
      'South',
      '80 CNY 10k',
      '20 orders',
      'North',
      '60 CNY 10k',
      '15 orders',
    ])
    const form = screen.getByRole('form', { name: 'Filter sales' })
    await user.click(within(form).getByRole('combobox', { name: 'Region' }))
    await user.click(screen.getByRole('option', { name: 'South' }))
    await user.type(within(form).getByRole('textbox', { name: 'Note' }), 'Retail')
    await user.click(within(form).getByRole('button', { name: 'Apply filters' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message:
        'Filter sales using my submitted region and note, then return the updated interface.',
      formValues: { region: 'South', note: 'Retail' },
    })
  })

  it('keeps the sales response renderable through every streaming character', () => {
    const onCaughtError = vi.fn()
    const onAction = vi.fn()
    const rendererProps = {
      libraryVersion: GENERATIVE_UI_LIBRARY_VERSION,
      isStreaming: true,
      fallbackText,
      onAction,
    }
    const { rerender } = render(<GenerativeUIRenderer {...rendererProps} source="" />, {
      onCaughtError,
    })

    for (let length = 1; length <= salesSource.length; length++) {
      rerender(<GenerativeUIRenderer {...rendererProps} source={salesSource.slice(0, length)} />)
    }
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled()
    rerender(<GenerativeUIRenderer {...rendererProps} source={salesSource} isStreaming={false} />)

    expect(onCaughtError).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '260 CNY 10k' })).toBeVisible()
    expect(screen.getByRole('table', { name: 'Regional sales data' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('All')
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeEnabled()
    expect(screen.queryByText(fallbackText)).not.toBeInTheDocument()
  })

  it('preserves editable fields when saved state is returned by the parent', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    function SavedSalesResponse() {
      const [state, setState] = useState<Record<string, unknown>>({})
      return (
        <GenerativeUIRenderer
          source={salesSource}
          libraryVersion={GENERATIVE_UI_LIBRARY_VERSION}
          isStreaming={false}
          fallbackText={fallbackText}
          onAction={onAction}
          initialState={state}
          onStateUpdate={(nextState) => {
            setState(structuredClone(nextState))
          }}
        />
      )
    }
    render(<SavedSalesResponse />, { reactStrictMode: true })

    const note = screen.getByRole('textbox', { name: 'Note' })
    await user.type(note, 'Retail')
    expect(note).toHaveValue('Retail')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message:
        'Filter sales using my submitted region and note, then return the updated interface.',
      formValues: { region: 'All', note: 'Retail' },
    })
  })

  it('keeps newer edits when an earlier save response returns', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const onStateUpdate = vi.fn<(state: Record<string, unknown>) => void>()
    const rendererProps = {
      source: salesSource,
      libraryVersion: GENERATIVE_UI_LIBRARY_VERSION,
      isStreaming: false,
      fallbackText,
      onAction,
      onStateUpdate,
      initialState: {},
    }
    const { rerender } = render(<GenerativeUIRenderer {...rendererProps} />)
    await user.click(screen.getByRole('combobox', { name: 'Region' }))
    await user.click(screen.getByRole('option', { name: 'South' }))
    expect(onStateUpdate).toHaveBeenCalled()
    const savedState = structuredClone(onStateUpdate.mock.calls.at(-1)![0])

    const note = screen.getByRole('textbox', { name: 'Note' })
    await user.type(note, 'Regression check')
    expect(note).toHaveValue('Regression check')
    rerender(<GenerativeUIRenderer {...rendererProps} initialState={savedState} />)

    expect(note).toHaveValue('Regression check')
    expect(screen.getByRole('combobox', { name: 'Region' })).toHaveTextContent('South')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message:
        'Filter sales using my submitted region and note, then return the updated interface.',
      formValues: { region: 'South', note: 'Regression check' },
    })
  })
})
