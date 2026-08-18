import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../document-title', () => ({
  default: () => <span>marketplace document title</span>,
}))

describe('marketplace route layout', () => {
  it('stays a server module so Flight can stream the async marketplace page', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../layout.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/^['"]use client['"]/)
  })

  it('renders marketplace children and the document title island', async () => {
    const { default: MarketplaceLayout } = await import('../layout')

    render(
      <MarketplaceLayout>
        <p>marketplace page</p>
      </MarketplaceLayout>,
    )

    expect(screen.getByText('marketplace document title')).toBeInTheDocument()
    expect(screen.getByText('marketplace page')).toBeInTheDocument()
  })
})
