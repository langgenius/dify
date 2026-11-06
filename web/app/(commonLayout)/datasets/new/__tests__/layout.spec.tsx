import type { ReactElement, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  getFeatures: vi.fn(),
  redirect: vi.fn((_href: string) => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('@/service/console', () => ({
  consoleClient: { features: { get: () => mocks.getFeatures() } },
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
    mocks.getFeatures.mockResolvedValue({ enable_knowledge_fs: true })
  })

  it('renders new knowledge routes when KnowledgeFS is enabled', async () => {
    await renderLayout(<div>New knowledge content</div>)

    expect(mocks.getFeatures).toHaveBeenCalledOnce()
    expect(screen.getByText('New knowledge content')).toBeInTheDocument()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('redirects to datasets when KnowledgeFS is disabled', async () => {
    mocks.getFeatures.mockResolvedValue({ enable_knowledge_fs: false })
    const { default: Layout } = await import('../layout')

    await expect(Layout({ children: <div>New knowledge content</div> })).rejects.toThrow(
      'NEXT_REDIRECT',
    )

    expect(mocks.redirect).toHaveBeenCalledWith('/datasets')
  })

  it('preserves KnowledgeFS availability failures', async () => {
    const error = new Error('KnowledgeFS availability unavailable')
    mocks.getFeatures.mockRejectedValue(error)
    const { default: Layout } = await import('../layout')

    await expect(Layout({ children: <div>New knowledge content</div> })).rejects.toBe(error)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
