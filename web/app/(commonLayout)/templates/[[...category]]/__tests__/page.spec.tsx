import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { redirect } from '@/next/navigation'
import TemplatesPage from '../page'

vi.mock('@/app/components/plugins/marketplace/templates', () => ({
  EmbeddedTemplatesMarketplace: ({ category, query }: { category: string; query: string }) => (
    <div>{`Templates catalog: ${category}:${query}`}</div>
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
