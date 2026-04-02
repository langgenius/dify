import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import FileExplorerIntro from '.././file-explorer-intro'

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey, ns, components }: {
    i18nKey: string
    ns?: string
    components?: Record<string, ReactNode>
  }) => (
    <span data-i18n-key={ns ? `${ns}.${i18nKey}` : i18nKey}>
      <span>Manage uploaded files here</span>
      {components?.mention}
      <span>to reference them in prompts.</span>
    </span>
  ),
}))

describe('FileExplorerIntro', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render translated intro copy with the injected mention chip', () => {
      render(<FileExplorerIntro />)

      expect(screen.getByText('Manage uploaded files here')).toBeInTheDocument()
      expect(screen.getByText('to reference them in prompts.')).toBeInTheDocument()
      expect(screen.getByText('@')).toBeInTheDocument()
      expect(screen.getByText('Manage uploaded files here').parentElement).toHaveAttribute('data-i18n-key', 'workflow.skill.startTab.fileExplorerIntro')
    })
  })

  describe('Presentation', () => {
    it('should render the intro as a bordered hint bar', () => {
      const { container } = render(<FileExplorerIntro />)

      expect(container.firstChild).toHaveClass('px-6', 'pb-4', 'pt-4')
      expect(container.querySelector('p')).toHaveClass(
        'flex',
        'h-8',
        'items-center',
        'rounded-md',
        'border',
        'border-text-accent-secondary',
      )
    })
  })
})
