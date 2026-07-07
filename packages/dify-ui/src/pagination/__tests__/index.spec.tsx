import { render } from 'vitest-browser-react'
import {
  Pagination,
  PaginationContent,
  PaginationNavigation,
  PaginationNext,
  PaginationPage,
  PaginationPageJump,
  PaginationPageList,
  PaginationPageSize,
  PaginationPrevious,
  PaginationRoot,
  PaginationSkeleton,
} from '../index'

const asHTMLElement = (element: HTMLElement | SVGElement) => element as HTMLElement

async function renderPagination({
  page = 2,
  totalPages = 200,
  onPageChange = vi.fn(),
  pageSize = 25,
  onPageSizeChange = vi.fn(),
}: {
  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  pageSize?: number
  onPageSizeChange?: (pageSize: number) => void
} = {}) {
  const screen = await render(
    <PaginationRoot
      page={page}
      totalPages={totalPages}
      onPageChange={onPageChange}
      data-testid="pagination"
    >
      <PaginationContent data-testid="content">
        <PaginationNavigation data-testid="controls">
          <PaginationPrevious />
          <PaginationPageJump />
          <PaginationNext />
        </PaginationNavigation>
        <PaginationPageList data-testid="pages" />
        <PaginationPageSize
          value={pageSize}
          options={[10, 25, 50]}
          onValueChange={onPageSizeChange}
        />
      </PaginationContent>
    </PaginationRoot>,
  )

  return {
    screen,
    onPageChange,
    onPageSizeChange,
  }
}

describe('Pagination primitive', () => {
  it('renders the pagination structure with semantic navigation', async () => {
    const { screen } = await renderPagination()

    await expect.element(screen.getByRole('navigation', { name: 'Pagination' })).toHaveAttribute('data-page', '2')
    await expect.element(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Edit page number, current page 2 of 200' })).toHaveTextContent('2/200')
    await expect.element(screen.getByRole('button', { name: 'Page 2, current page' })).toHaveAttribute('aria-current', 'page')
    await expect.element(screen.getByText('…')).toBeInTheDocument()
  })

  it('uses one-based page changes for previous, next, and page buttons', async () => {
    const { screen, onPageChange } = await renderPagination({ page: 4 })

    asHTMLElement(screen.getByRole('button', { name: 'Previous page' }).element()).click()
    asHTMLElement(screen.getByRole('button', { name: 'Next page' }).element()).click()
    asHTMLElement(screen.getByRole('button', { name: 'Go to page 6' }).element()).click()

    expect(onPageChange).toHaveBeenNthCalledWith(1, 3)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 5)
    expect(onPageChange).toHaveBeenNthCalledWith(3, 6)
  })

  it('disables previous at the first page', async () => {
    const { screen } = await renderPagination({ page: 1, totalPages: 10 })

    await expect.element(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('disables next at the last page', async () => {
    const { screen } = await renderPagination({ page: 10, totalPages: 10 })

    await expect.element(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('clamps invalid root page values without exposing invalid state', async () => {
    const { screen } = await renderPagination({ page: 999, totalPages: 10 })

    await expect.element(screen.getByRole('navigation', { name: 'Pagination' })).toHaveAttribute('data-page', '10')
    await expect.element(screen.getByRole('button', { name: 'Page 10, current page' })).toHaveAttribute('aria-current', 'page')
  })

  it('switches the page summary into a selected labelled number field', async () => {
    const { screen } = await renderPagination()

    asHTMLElement(screen.getByRole('button', { name: 'Edit page number, current page 2 of 200' }).element()).click()

    await expect.element(screen.getByRole('textbox', { name: 'Page number' })).toBeInTheDocument()
    const input = asHTMLElement(screen.getByRole('textbox', { name: 'Page number' }).element()) as HTMLInputElement

    await expect.element(screen.getByRole('textbox', { name: 'Page number' })).toHaveValue('2')
    expect(input.parentElement?.parentElement?.parentElement).toHaveAttribute('data-page-summary', '2/200')
    await vi.waitFor(() => {
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe(1)
    })
  })

  it('returns to the summary button when the page input loses focus', async () => {
    const { screen } = await renderPagination()

    asHTMLElement(screen.getByRole('button', { name: 'Edit page number, current page 2 of 200' }).element()).click()
    await expect.element(screen.getByRole('textbox', { name: 'Page number' })).toBeInTheDocument()
    asHTMLElement(screen.getByRole('textbox', { name: 'Page number' }).element()).blur()

    await expect.element(screen.getByRole('button', { name: 'Edit page number, current page 2 of 200' })).toBeInTheDocument()
  })

  it('commits the page input editing mode with Enter', async () => {
    const { screen } = await renderPagination()

    asHTMLElement(screen.getByRole('button', { name: 'Edit page number, current page 2 of 200' }).element()).click()
    await expect.element(screen.getByRole('textbox', { name: 'Page number' })).toBeInTheDocument()
    const input = asHTMLElement(screen.getByRole('textbox', { name: 'Page number' }).element()) as HTMLInputElement

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(input)
    })

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))

    const summaryButton = screen.getByRole('button', { name: 'Edit page number, current page 2 of 200' })
    await expect.element(summaryButton).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(summaryButton.element())
    })
  })

  it('cancels the page input editing mode with Escape', async () => {
    const { screen, onPageChange } = await renderPagination()

    asHTMLElement(screen.getByRole('button', { name: 'Edit page number, current page 2 of 200' }).element()).click()
    await expect.element(screen.getByRole('textbox', { name: 'Page number' })).toBeInTheDocument()
    const input = asHTMLElement(screen.getByRole('textbox', { name: 'Page number' }).element()) as HTMLInputElement

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(input)
    })

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))

    const summaryButton = screen.getByRole('button', { name: 'Edit page number, current page 2 of 200' })
    await expect.element(summaryButton).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(summaryButton.element())
    })
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('uses segmented control semantics for page size', async () => {
    const { screen, onPageSizeChange } = await renderPagination()

    await expect.element(screen.getByRole('button', { name: '25' })).toHaveAttribute('aria-pressed', 'true')

    asHTMLElement(screen.getByRole('button', { name: '50' }).element()).click()

    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })

  it('renders the complete pagination bar with optional page size controls', async () => {
    const onPageSizeChange = vi.fn()
    const screen = await render(
      <Pagination
        page={2}
        totalPages={10}
        onPageChange={vi.fn()}
        pageSize={{
          value: 25,
          options: [10, 25, 50],
          onValueChange: onPageSizeChange,
        }}
      />,
    )

    await expect.element(screen.getByRole('button', { name: 'Edit page number, current page 2 of 10' })).toBeInTheDocument()
    await expect.element(screen.getByRole('group', { name: 'Items per page' })).toBeInTheDocument()
  })

  it('uses a localized action label for editing the page number', async () => {
    const screen = await render(
      <Pagination
        page={2}
        totalPages={10}
        onPageChange={vi.fn()}
        labels={{
          editPageNumber: (page, totalPages) => `Change page, current page ${page} of ${totalPages}`,
        }}
      />,
    )

    await expect.element(screen.getByRole('button', { name: 'Change page, current page 2 of 10' })).toBeInTheDocument()
  })

  it('keeps facade page numbers centered when page size controls are omitted', async () => {
    const screen = await render(
      <Pagination
        page={2}
        totalPages={10}
        onPageChange={vi.fn()}
      />,
    )

    await expect.element(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument()
  })

  it('does not expose invalid page controls when there are no pages', async () => {
    const screen = await render(
      <Pagination
        page={1}
        totalPages={0}
        onPageChange={vi.fn()}
      />,
    )

    expect(screen.container.querySelector('nav[aria-label="Pagination"]')).not.toBeInTheDocument()
    expect(screen.container.querySelector('button[aria-label*="current page 1 of 0"]')).not.toBeInTheDocument()
  })

  it('omits compound page jump and page list content for empty pagination state', async () => {
    const { screen } = await renderPagination({ page: 1, totalPages: 0 })

    await expect.element(screen.getByRole('navigation', { name: 'Pagination' })).toHaveAttribute('data-page', '1')
    expect(screen.container.querySelector('button[aria-label*="current page 1 of 0"]')).not.toBeInTheDocument()
    expect(screen.container.querySelector('button[aria-label="Previous page"]')).not.toBeInTheDocument()
    expect(screen.container.querySelector('button[aria-label="Next page"]')).not.toBeInTheDocument()
    expect(screen.container.querySelector('ol')).not.toBeInTheDocument()
  })

  it('allows custom page rendering while keeping the shared context', async () => {
    const onPageChange = vi.fn()
    const screen = await render(
      <PaginationRoot page={3} totalPages={5} onPageChange={onPageChange}>
        <ol>
          <li>
            <PaginationPage page={4} className="custom-page">
              Four
            </PaginationPage>
          </li>
        </ol>
      </PaginationRoot>,
    )

    asHTMLElement(screen.getByRole('button', { name: 'Go to page 4' }).element()).click()

    await expect.element(screen.getByRole('button', { name: 'Go to page 4' })).toHaveClass('custom-page')
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('renders a non-interactive loading skeleton', async () => {
    const screen = await render(<PaginationSkeleton data-testid="skeleton" />)

    await expect.element(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
  })
})
