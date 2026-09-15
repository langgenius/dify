import type { FunctionComponent, ReactElement, ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { redirect } from '@/next/navigation'
import TemplatesPage from '../page'

type TemplatesPageProps = Parameters<typeof TemplatesPage>[0]

const resolveTemplatesPage = async (props: TemplatesPageProps) => {
  const tree = TemplatesPage(props) as ReactElement<{
    children: ReactElement
    className: string
    id: string
  }>
  const child = tree.props.children
  const content = await (child.type as FunctionComponent<typeof child.props>)(child.props)
  return createElement(tree.type, tree.props, content)
}

vi.mock('@/app/components/plugins/marketplace/templates/template-detail-route', () => ({
  TemplateDetailRouteProvider: ({
    children,
    initialSelection,
  }: {
    children: ReactNode
    initialSelection?: { id: string }
  }) => (
    <div data-testid="template-route" data-template-id={initialSelection?.id ?? ''}>
      {children}
    </div>
  ),
}))

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
  it('does not stream async server children that Flight would double-resolve', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../page.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/export default async function TemplatesPage/)
    expect(TemplatesPage.constructor.name).not.toBe('AsyncFunction')
  })

  it('renders the templates catalog at /templates', async () => {
    const page = await resolveTemplatesPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ q: 'agent' }),
    })

    render(page)

    expect(screen.getByText('Templates catalog: all:agent')).toBeInTheDocument()
    expect(
      screen.getByText('Templates catalog: all:agent').closest('#marketplace-container'),
    ).toBeInTheDocument()
  })

  it('passes a supported path category to the templates catalog', async () => {
    const page = await resolveTemplatesPage({
      params: Promise.resolve({ category: ['marketing'] }),
      searchParams: Promise.resolve({}),
    })

    render(page)

    expect(screen.getByText('Templates catalog: marketing:')).toBeInTheDocument()
  })

  it('validates page, view and sort params at the route boundary', async () => {
    const page = await resolveTemplatesPage({
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
    const page = await resolveTemplatesPage({
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

  it('opens /templates/{publisher}/{uuid} as the all catalog with a selected template', async () => {
    const templateId = 'c558a1fb-bb8c-4a5e-9404-d681c6659cf2'
    const page = await resolveTemplatesPage({
      params: Promise.resolve({ category: ['langgenius', templateId] }),
      searchParams: Promise.resolve({}),
    })

    render(page)

    expect(screen.getByText('Templates catalog: all:')).toBeInTheDocument()
    expect(screen.getByTestId('template-route')).toHaveAttribute('data-template-id', templateId)
  })

  it('opens template recommendations in the existing Dify import flow', async () => {
    await expect(
      resolveTemplatesPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ tid: 'template/one' }),
      }),
    ).rejects.toThrow('redirect:/apps?template-id=template%2Fone')

    expect(redirect).toHaveBeenCalledWith('/apps?template-id=template%2Fone')
  })
})
