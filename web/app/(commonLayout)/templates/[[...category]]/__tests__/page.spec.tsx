import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { redirect } from '@/next/navigation'
import TemplatesPage from '../page'

vi.mock('@/app/components/plugins/marketplace/templates', () => ({
  EmbeddedTemplatesMarketplace: ({
    category,
    page,
    query,
    sortBy,
    sortOrder,
    view,
  }: {
    category: string
    page: number
    query: string
    sortBy?: string
    sortOrder?: string
    view?: string
  }) => (
    <div
      data-testid="catalog"
      data-page={page}
      data-sort-by={sortBy}
      data-sort-order={sortOrder}
      data-view={view}
    >
      {`Templates catalog: ${category}:${query}`}
    </div>
  ),
}))

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: () => Promise.resolve('en-US'),
}))

vi.mock('@/next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
}))

describe('embedded templates route', () => {
  it('renders the templates catalog at /templates', async () => {
    const page = await TemplatesPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ q: 'agent' }),
    })

    render(page)

    expect(screen.getByText('Templates catalog: all:agent')).toBeInTheDocument()
    expect(screen.getByText('Templates catalog: all:agent').parentElement).toHaveAttribute(
      'id',
      'marketplace-container',
    )
  })

  it('passes a supported path category to the templates catalog', async () => {
    const page = await TemplatesPage({
      params: Promise.resolve({ category: ['marketing'] }),
      searchParams: Promise.resolve({}),
    })

    render(page)

    expect(screen.getByText('Templates catalog: marketing:')).toBeInTheDocument()
  })

  it('validates page, view and sort params at the route boundary', async () => {
    const page = await TemplatesPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({
        page: '3',
        q: 'agent',
        sort_by: 'created_at',
        sort_order: 'ASC',
        view: 'search',
      }),
    })

    render(page)

    const catalog = screen.getByTestId('catalog')
    expect(catalog).toHaveAttribute('data-page', '3')
    expect(catalog).toHaveAttribute('data-sort-by', 'created_at')
    expect(catalog).toHaveAttribute('data-sort-order', 'ASC')
    expect(catalog).toHaveAttribute('data-view', 'search')
  })

  it('falls back to defaults for unsupported page, view and sort params', async () => {
    const page = await TemplatesPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({
        page: '-2',
        q: 'agent',
        sort_by: 'garbage',
        sort_order: 'sideways',
        view: 'iframe',
      }),
    })

    render(page)

    const catalog = screen.getByTestId('catalog')
    expect(catalog).toHaveAttribute('data-page', '1')
    expect(catalog).not.toHaveAttribute('data-sort-by')
    expect(catalog).not.toHaveAttribute('data-sort-order')
    expect(catalog).not.toHaveAttribute('data-view')
  })

  it('opens template recommendations in the existing Dify import flow', async () => {
    await expect(
      TemplatesPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ tid: 'template/one' }),
      }),
    ).rejects.toThrow('redirect:/apps?template-id=template%2Fone')

    expect(redirect).toHaveBeenCalledWith('/apps?template-id=template%2Fone')
  })
})
