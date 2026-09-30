import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  getSystemFeatures: vi.fn(),
  redirect: vi.fn((_href: string) => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('@/features/system-features/server', () => ({
  getSystemFeatures: () => mocks.getSystemFeatures(),
}))

vi.mock('@/next/navigation', () => ({
  redirect: (href: string) => mocks.redirect(href),
}))

async function renderLayout(children: ReactNode) {
  const { default: Layout } = await import('../layout')
  const element = await Layout({ children })
  render(element as ReactElement)
}

describe('NewKnowledgeLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSystemFeatures.mockResolvedValue({ knowledge_fs_enabled: true })
  })

  it('renders new knowledge routes when KnowledgeFS is enabled', async () => {
    await renderLayout(<div>New knowledge content</div>)

    expect(mocks.getSystemFeatures).toHaveBeenCalledOnce()
    expect(screen.getByText('New knowledge content')).toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('redirects to datasets when KnowledgeFS is disabled', async () => {
    mocks.getSystemFeatures.mockResolvedValue({ knowledge_fs_enabled: false })
    const { default: Layout } = await import('../layout')

    await expect(Layout({ children: <div>New knowledge content</div> })).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(mocks.redirect).toHaveBeenCalledWith('/datasets')
  })

  it('preserves System Features failures', async () => {
    const error = new Error('System Features unavailable')
    mocks.getSystemFeatures.mockRejectedValue(error)
    const { default: Layout } = await import('../layout')

    await expect(Layout({ children: <div>New knowledge content</div> })).rejects.toBe(error)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
