import type { GenerativeUIRendererProps } from '../renderer'
import { describe, expect, it, vi } from 'vite-plus/test'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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
  beforeEach(async () => {
    await page.viewport(1000, 800)
    onTestFinished(guardUnexpectedFetch())
  })

  it('keeps table rows renderable across every streaming character boundary', async () => {
    const onCaughtError = vi.fn()
    const rendererProps = props({ source: '', isStreaming: true })
    const screen = await render(<GenerativeUIRenderer {...rendererProps} />, {
      createRootOptions: { onCaughtError },
    })

    for (let length = 1; length <= tableSource.length; length++) {
      await screen.rerender(
        <GenerativeUIRenderer {...rendererProps} source={tableSource.slice(0, length)} />,
      )
    }
    await screen.rerender(
      <GenerativeUIRenderer {...rendererProps} source={tableSource} isStreaming={false} />,
    )

    expect(onCaughtError).not.toHaveBeenCalled()
    const table = page.getByRole('table', { name: 'Sales by region' })
    await expect.element(table).toBeVisible()
    await expect
      .poll(() =>
        table
          .getByRole('columnheader')
          .elements()
          .map((header) => header.textContent),
      )
      .toEqual(['Region', 'Sales'])
    await expect
      .poll(() =>
        table
          .getByRole('cell')
          .elements()
          .map((cell) => cell.textContent),
      )
      .toEqual(['East', '80', 'West', '40'])
    await expect.element(page.getByText(rendererProps.fallbackText)).not.toBeInTheDocument()
  })

  it('renders streamed references and enables conversation actions only after completion', async () => {
    const onAction = vi.fn()
    const initialProps = props({
      source: 'root = Stack([heading, results, details])\nheading = Heading("Sales")\n',
      isStreaming: true,
      onAction,
    })
    const screen = await render(<GenerativeUIRenderer {...initialProps} />)

    await expect.element(page.getByRole('heading', { name: 'Sales' })).toBeVisible()
    await expect.element(page.getByRole('table')).not.toBeInTheDocument()

    await screen.rerender(<GenerativeUIRenderer {...initialProps} source={tableSource} />)
    const table = page.getByRole('table', { name: 'Sales by region' })
    await expect.element(table.getByRole('cell', { name: '80' })).toBeVisible()
    const button = page.getByRole('button', { name: 'Show East' })
    await expect.element(button).toBeDisabled()
    expect(onAction).not.toHaveBeenCalled()

    await screen.rerender(
      <GenerativeUIRenderer {...initialProps} source={tableSource} isStreaming={false} />,
    )
    await button.click()
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message: 'Show sales for the East region',
    })
  })

  it('restores form values, keeps drafts across source updates, and submits only that form', async () => {
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
    const screen = await render(<GenerativeUIRenderer {...rendererProps} />)

    const form = page.getByRole('form', { name: 'Filter results' })
    const keyword = form.getByRole('textbox', { name: 'Keyword' })
    await expect.element(keyword).toHaveValue('saved')
    await expect.element(form.getByRole('combobox', { name: 'Region' })).toHaveTextContent('West')
    await keyword.fill('updated')

    await screen.rerender(
      <GenerativeUIRenderer
        {...rendererProps}
        source={`${formSource}\nunused = Text("Extra context")`}
      />,
    )
    await expect.element(keyword).toHaveValue('updated')
    await form.getByRole('button', { name: 'Apply' }).click()
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
    const onAction = vi.fn()
    await render(<GenerativeUIRenderer {...props({ source: formSource, onAction })} />)

    await page.getByRole('button', { name: 'Apply' }).click()
    expect(onAction).not.toHaveBeenCalled()
    const keyword = page.getByRole('textbox', { name: 'Keyword' })
    await expect.element(keyword).toHaveFocus()
    await keyword.fill('hardware')
    await page.getByRole('button', { name: 'Apply' }).click()
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message: 'Apply these filters',
      formValues: { region: 'East', keyword: 'hardware' },
    })
  })

  it('writes to the current field and form after the generated source replaces their names', async () => {
    const onAction = vi.fn()
    const rendererProps = props({ source: formSource, onAction })
    const screen = await render(<GenerativeUIRenderer {...rendererProps} />)
    await page.getByRole('textbox', { name: 'Keyword' }).fill('previous')

    const replacement = formSource
      .replace('Form("filters"', 'Form("advanced"')
      .replace('TextField("keyword", "Keyword"', 'TextField("search", "Search"')
    await screen.rerender(<GenerativeUIRenderer {...rendererProps} source={replacement} />)

    const search = page.getByRole('textbox', { name: 'Search' })
    await expect.element(search).toHaveValue('')
    await search.fill('books')
    await page.getByRole('combobox', { name: 'Region' }).click()
    await page.getByRole('option', { name: 'West' }).click()
    await expect.element(search).toHaveValue('books')
    await page.getByRole('button', { name: 'Apply' }).click()

    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      type: 'continue_conversation',
      message: 'Apply these filters',
      formValues: { region: 'West', search: 'books' },
    })
  })

  it('submits the selected option through the real controls and keyboard', async () => {
    const onAction = vi.fn()
    await render(<GenerativeUIRenderer {...props({ source: formSource, onAction })} />)
    await page.getByRole('combobox', { name: 'Region' }).click()
    await page.getByRole('option', { name: 'West' }).click()
    await expect.element(page.getByRole('combobox', { name: 'Region' })).toHaveTextContent('West')
    await page.getByRole('textbox', { name: 'Keyword' }).fill('books')
    await userEvent.tab()
    await expect.element(page.getByRole('button', { name: 'Apply' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        formValues: { region: 'West', keyword: 'books' },
      }),
    )
  })

  it('keeps read-only history noninteractive', async () => {
    await render(<GenerativeUIRenderer {...props({ source: formSource, isReadOnly: true })} />)
    await expect.element(page.getByRole('textbox', { name: 'Keyword' })).toBeDisabled()
    await expect.element(page.getByRole('combobox', { name: 'Region' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('rejects colliding form names before mounting fields and preserves an independent form', async () => {
    const onAction = vi.fn()
    const onStateUpdate = vi.fn()
    await render(
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

    await expect.element(page.getByRole('form', { name: 'First form' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('form', { name: 'Second form' })).not.toBeInTheDocument()
    await page.getByRole('textbox', { name: 'Your name' }).fill('Carol')
    await page.getByRole('button', { name: 'Send valid' }).click()
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
    await render(<GenerativeUIRenderer {...rendererProps} />)

    const table = page.getByRole('table', { name: 'Valid table' })
    await expect.element(table).toBeVisible()
    await expect.element(table.getByRole('cell', { name: '80' })).toBeVisible()
    await expect.element(page.getByRole('form')).not.toBeInTheDocument()
    await expect.element(page.getByRole('textbox')).not.toBeInTheDocument()
    await expect.element(page.getByRole('combobox')).not.toBeInTheDocument()
    await expect.element(page.getByRole('table', { name: 'Broken table' })).not.toBeInTheDocument()
    await expect.element(page.getByText('appDebug.generativeUI.unavailable')).toBeVisible()
    await expect.element(page.getByText(rendererProps.fallbackText)).not.toBeInTheDocument()
  })

  it.each(['bad = MetricCard("Revenue", 80, null)', ''])(
    'preserves a valid table when a sibling cannot be parsed or resolved: %s',
    async (definition) => {
      const rendererProps = props({
        source: `root = Stack([good, bad])
good = Table("Valid table", ["Region", "Sales"], [["East", "80"]])
${definition}`,
      })
      await render(<GenerativeUIRenderer {...rendererProps} />)

      await expect.element(page.getByText('appDebug.generativeUI.unavailable')).toBeVisible()
      await expect.element(page.getByRole('table', { name: 'Valid table' })).toBeVisible()
      await expect.element(page.getByText(rendererProps.fallbackText)).not.toBeInTheDocument()
    },
  )

  it('shows readable fallback for invalid completed output and recovers on replacement', async () => {
    const rendererProps = props({ source: 'root = Unknown("broken")' })
    const screen = await render(<GenerativeUIRenderer {...rendererProps} />)
    await expect.element(page.getByText(rendererProps.fallbackText)).toBeVisible()

    await screen.rerender(<GenerativeUIRenderer {...rendererProps} source={tableSource} />)
    await expect.element(page.getByRole('table', { name: 'Sales by region' })).toBeVisible()
    await expect.element(page.getByText(rendererProps.fallbackText)).not.toBeInTheDocument()
  })

  it('does not interpret stored content with an unsupported component library', async () => {
    const rendererProps = props({ libraryVersion: 'unknown-library' })
    await render(<GenerativeUIRenderer {...rendererProps} />)
    await expect.element(page.getByText(rendererProps.fallbackText)).toBeVisible()
    await expect.element(page.getByRole('button')).not.toBeInTheDocument()
  })

  it.each(['root = Stack([missing])', 'root = Stack([])', 'root = Stack([Heading("Unfinished'])(
    'shows fallback when a completed program has missing content: %s',
    async (source) => {
      const rendererProps = props({ source })
      await render(<GenerativeUIRenderer {...rendererProps} />)
      await expect.element(page.getByText(rendererProps.fallbackText)).toBeVisible()
    },
  )

  it('renders generated text as text without introducing executable markup', async () => {
    await render(
      <GenerativeUIRenderer
        {...props({ source: 'root = Stack([Text("<img src=x onerror=alert(1)>")])' })}
      />,
    )
    await expect.element(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    await expect.element(page.getByRole('img')).not.toBeInTheDocument()
  })
})
