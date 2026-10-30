import type { GenerativeUIRendererProps } from '../renderer'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { GENERATIVE_UI_LIBRARY_VERSION } from '../registry/definitions'
import { GenerativeUIRenderer } from '../renderer'

const tableSource = `root = Stack([heading, results, details])
heading = Heading("Sales")
results = Table("Sales by region", ["Region", "Sales"], [["East", "80"], ["West", "40"]])
details = ActionButton("Show East", "Show sales for the East region")`

const formSource = `root = Stack([filters])
filters = Form("filters", "Filter results", "Apply", "Apply these filters", [region, keyword])
region = SelectField("region", "Region", ["East", "West"], "East", true)
keyword = TextField("keyword", "Keyword", "", true)`

function props(overrides: Partial<GenerativeUIRendererProps> = {}): GenerativeUIRendererProps {
  return {
    source: tableSource,
    libraryVersion: GENERATIVE_UI_LIBRARY_VERSION,
    isStreaming: false,
    fallbackText: 'Sales are available in the text response.',
    onAction: vi.fn(),
    ...overrides,
  }
}

describe('GenerativeUIRenderer', () => {
  it('keeps table rows renderable across every streaming character boundary', () => {
    const onCaughtError = vi.fn()
    const rendererProps = props({ source: '', isStreaming: true })
    const { rerender } = render(<GenerativeUIRenderer {...rendererProps} />, { onCaughtError })

    for (let length = 1; length <= tableSource.length; length++) {
      rerender(<GenerativeUIRenderer {...rendererProps} source={tableSource.slice(0, length)} />)
    }
    rerender(<GenerativeUIRenderer {...rendererProps} source={tableSource} isStreaming={false} />)

    expect(onCaughtError).not.toHaveBeenCalled()
    const table = screen.getByRole('table', { name: 'Sales by region' })
    expect(table).toBeVisible()
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Region', 'Sales'])
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['East', '80', 'West', '40'])
    expect(screen.queryByText(rendererProps.fallbackText)).not.toBeInTheDocument()
  })

  it('renders streamed references and enables conversation actions only after completion', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const initialProps = props({
      source: 'root = Stack([heading, results, details])\nheading = Heading("Sales")\n',
      isStreaming: true,
      onAction,
    })
    const { rerender } = render(<GenerativeUIRenderer {...initialProps} />)

    expect(screen.getByRole('heading', { name: 'Sales' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    rerender(<GenerativeUIRenderer {...initialProps} source={tableSource} />)
    const table = screen.getByRole('table', { name: 'Sales by region' })
    expect(within(table).getByRole('cell', { name: '80' })).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Show East' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onAction).not.toHaveBeenCalled()

    rerender(<GenerativeUIRenderer {...initialProps} source={tableSource} isStreaming={false} />)
    await user.click(screen.getByRole('button', { name: 'Show East' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message: 'Show sales for the East region',
    })
  })

  it('restores form values, keeps drafts across source updates, and submits only that form', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const onStateUpdate = vi.fn()
    const rendererProps = props({
      source: formSource,
      onAction,
      onStateUpdate,
      initialState: {
        filters: { region: { value: 'West' }, keyword: { value: 'saved' } },
        anotherForm: { privateNote: { value: 'unrelated' } },
      },
    })
    const { rerender } = render(<GenerativeUIRenderer {...rendererProps} />)

    const form = screen.getByRole('form', { name: 'Filter results' })
    const keyword = within(form).getByRole('textbox', { name: 'Keyword' })
    expect(keyword).toHaveValue('saved')
    expect(within(form).getByRole('combobox', { name: 'Region' })).toHaveTextContent('West')
    await user.clear(keyword)
    await user.type(keyword, 'updated')

    rerender(
      <GenerativeUIRenderer
        {...rendererProps}
        source={`${formSource}\nunused = Text("Extra context")`}
      />,
    )
    expect(screen.getByRole('textbox', { name: 'Keyword' })).toHaveValue('updated')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message: 'Apply these filters',
      formValues: { region: 'West', keyword: 'updated' },
    })
    expect(onStateUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          keyword: expect.objectContaining({ value: 'updated' }),
        }),
      }),
    )
  })

  it('validates required fields and includes untouched defaults in submission', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<GenerativeUIRenderer {...props({ source: formSource, onAction })} />)

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onAction).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: 'Keyword' }), 'hardware')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message: 'Apply these filters',
      formValues: { region: 'East', keyword: 'hardware' },
    })
  })

  it('writes to the current field and form after the generated source replaces their names', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const rendererProps = props({ source: formSource, onAction })
    const { rerender } = render(<GenerativeUIRenderer {...rendererProps} />)
    await user.type(screen.getByRole('textbox', { name: 'Keyword' }), 'previous')

    const replacement = formSource
      .replace('Form("filters"', 'Form("advanced"')
      .replace('TextField("keyword", "Keyword"', 'TextField("search", "Search"')
    rerender(<GenerativeUIRenderer {...rendererProps} source={replacement} />)

    const search = screen.getByRole('textbox', { name: 'Search' })
    expect(search).toHaveValue('')
    await user.type(search, 'books')
    await user.click(screen.getByRole('combobox', { name: 'Region' }))
    await user.click(screen.getByRole('option', { name: 'West' }))
    expect(search).toHaveValue('books')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message: 'Apply these filters',
      formValues: { region: 'West', search: 'books' },
    })
  })

  it('allows selecting an option through the Dify UI control', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<GenerativeUIRenderer {...props({ source: formSource, onAction })} />)
    await user.click(screen.getByRole('combobox', { name: 'Region' }))
    await user.click(screen.getByRole('option', { name: 'West' }))
    await user.type(screen.getByRole('textbox', { name: 'Keyword' }), 'books')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        formValues: { region: 'West', keyword: 'books' },
      }),
    )
  })

  it('keeps read-only history noninteractive', () => {
    render(<GenerativeUIRenderer {...props({ source: formSource, isReadOnly: true })} />)
    expect(screen.getByRole('textbox', { name: 'Keyword' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Region' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('rejects colliding form names before mounting fields and preserves an independent form', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const onStateUpdate = vi.fn()
    render(
      <GenerativeUIRenderer
        {...props({
          source: `root = Stack([first, second, valid])
first = Form("shared", "First form", "Send first", "First", [TextField("name", "First name", "Alice")])
second = Form("shared", "Second form", "Send second", "Second", [TextField("name", "Second name", "Bob")])
valid = Form("valid", "Independent form", "Send valid", "Valid", [TextField("name", "Your name", "")])`,
          onAction,
          onStateUpdate,
        })}
      />,
    )

    expect(screen.queryByRole('form', { name: 'First form' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Second form' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Carol')
    await user.click(screen.getByRole('button', { name: 'Send valid' }))
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message: 'Valid',
      formValues: { name: 'Carol' },
    })
    expect(onStateUpdate).toHaveBeenLastCalledWith({
      valid: { name: expect.objectContaining({ value: 'Carol' }) },
    })
  })

  it.each([
    [
      'duplicate field names',
      'Form("filters", "Broken form", "Apply", "Filter", [TextField("name", "First", "Alice"), TextField("name", "Second", "Bob")])',
    ],
    [
      'invalid select default',
      'Form("filters", "Broken form", "Apply", "Filter", [SelectField("region", "Region", ["East", "West"], "North")])',
    ],
    ['a field outside a form', 'TextField("name", "Outside", "Alice")'],
    [
      'a nested form',
      'Form("outer", "Outer", "Send", "Outer", [Form("inner", "Inner", "Send", "Inner", [])])',
    ],
    ['a table row with extra cells', 'Table("Broken table", ["Region"], [["East", "80"]])'],
  ])('isolates %s while retaining valid data', async (_case, invalid) => {
    const rendererProps = props({
      source: `root = Stack([good, bad])
good = Table("Valid table", ["Region", "Sales"], [["East", "80"]])
bad = ${invalid}`,
    })
    render(<GenerativeUIRenderer {...rendererProps} />)

    expect(screen.getByRole('table', { name: 'Valid table' })).toBeVisible()
    expect(
      within(screen.getByRole('table', { name: 'Valid table' })).getByRole('cell', { name: '80' }),
    ).toBeVisible()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Broken table' })).not.toBeInTheDocument()
    expect(await screen.findByText('appDebug.generativeUI.unavailable')).toBeVisible()
    expect(screen.queryByText(rendererProps.fallbackText)).not.toBeInTheDocument()
  })

  it.each(['bad = MetricCard("Revenue", 80, null)', ''])(
    'preserves a valid table when a sibling cannot be parsed or resolved: %s',
    async (definition) => {
      const rendererProps = props({
        source: `root = Stack([good, bad])
good = Table("Valid table", ["Region", "Sales"], [["East", "80"]])
${definition}`,
      })
      render(<GenerativeUIRenderer {...rendererProps} />)

      expect(await screen.findByText('appDebug.generativeUI.unavailable')).toBeVisible()
      expect(screen.getByRole('table', { name: 'Valid table' })).toBeVisible()
      expect(screen.queryByText(rendererProps.fallbackText)).not.toBeInTheDocument()
    },
  )

  it('shows readable fallback for invalid completed output and recovers on replacement', async () => {
    const rendererProps = props({ source: 'root = Unknown("broken")' })
    const { rerender } = render(<GenerativeUIRenderer {...rendererProps} />)
    expect(await screen.findByText(rendererProps.fallbackText)).toBeVisible()

    rerender(<GenerativeUIRenderer {...rendererProps} source={tableSource} />)
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'Sales by region' })).toBeVisible(),
    )
    expect(screen.queryByText(rendererProps.fallbackText)).not.toBeInTheDocument()
  })

  it('does not interpret stored content with an unsupported component library', () => {
    const rendererProps = props({ libraryVersion: 'unknown-library' })
    render(<GenerativeUIRenderer {...rendererProps} />)
    expect(screen.getByText(rendererProps.fallbackText)).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['root = Stack([missing])', 'root = Stack([])', 'root = Stack([Heading("Unfinished'])(
    'shows fallback when a completed program has missing content: %s',
    async (source) => {
      const rendererProps = props({ source })
      render(<GenerativeUIRenderer {...rendererProps} />)
      expect(await screen.findByText(rendererProps.fallbackText)).toBeVisible()
    },
  )

  it('renders generated text as text without introducing executable markup', () => {
    render(
      <GenerativeUIRenderer
        {...props({ source: 'root = Stack([Text("<img src=x onerror=alert(1)>")])' })}
      />,
    )
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
