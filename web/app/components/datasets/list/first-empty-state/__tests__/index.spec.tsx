import { render, screen } from '@testing-library/react'
import DatasetFirstEmptyState from '..'

vi.mock('@/next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode, href: string, className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

describe('DatasetFirstEmptyState', () => {
  it('uses the pipeline icon for the create-from-pipeline action', () => {
    render(<DatasetFirstEmptyState />)

    const pipelineLink = screen.getByRole('link', { name: /dataset\.firstEmpty\.pipelineTitle/ })

    expect(pipelineLink).toHaveAttribute('href', '/datasets/create-from-pipeline')
    expect(pipelineLink.querySelector('.i-custom-vender-pipeline-pipeline-line')).toBeInTheDocument()
  })
})
