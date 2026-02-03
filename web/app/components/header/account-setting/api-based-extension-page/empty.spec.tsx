import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { useDocLink } from '@/context/i18n'
import Empty from './empty'

vi.mock('@/context/i18n', () => ({
  useDocLink: vi.fn(),
}))

describe('Empty State', () => {
  it('renders title and documentation link', () => {
    const mockDocLink = vi.fn((path?: string) => `https://docs.dify.ai${path || ''}`)
    vi.mocked(useDocLink).mockReturnValue(mockDocLink as unknown as ReturnType<typeof useDocLink>)

    render(<Empty />)

    expect(screen.getByText('common.apiBasedExtension.title')).toBeInTheDocument()
    const link = screen.getByText('common.apiBasedExtension.link')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', 'https://docs.dify.ai/use-dify/workspace/api-extension/api-extension')
  })
})
