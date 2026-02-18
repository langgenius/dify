import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { vi } from 'vitest'
import { AppModeEnum } from '@/types/app'
import LinkedAppsPanel from './index'

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode, href: string, className: string }) => (
    <a href={href} className={className} data-testid="link-item">
      {children}
    </a>
  ),
}))

describe('LinkedAppsPanel Component', () => {
  const mockRelatedApps = [
    {
      id: 'app-1',
      name: 'Chatbot App',
      mode: AppModeEnum.CHAT,
      icon_type: 'emoji' as const,
      icon: '🤖',
      icon_background: '#FFEAD5',
      icon_url: '',
    },
    {
      id: 'app-2',
      name: 'Workflow App',
      mode: AppModeEnum.WORKFLOW,
      icon_type: 'image' as const,
      icon: 'file-id',
      icon_background: '#E4FBCC',
      icon_url: 'https://example.com/icon.png',
    },
    {
      id: 'app-3',
      name: '',
      mode: AppModeEnum.AGENT_CHAT,
      icon_type: 'emoji' as const,
      icon: '🕵️',
      icon_background: '#D3F8DF',
      icon_url: '',
    },
  ]

  describe('Render', () => {
    it('renders correctly with multiple apps', () => {
      render(<LinkedAppsPanel relatedApps={mockRelatedApps} isMobile={false} />)

      const items = screen.getAllByTestId('link-item')
      expect(items).toHaveLength(3)

      expect(screen.getByText('Chatbot App')).toBeInTheDocument()
      expect(screen.getByText('Workflow App')).toBeInTheDocument()
      expect(screen.getByText('--')).toBeInTheDocument()
    })

    it('displays correct app mode labels', () => {
      render(<LinkedAppsPanel relatedApps={mockRelatedApps} isMobile={false} />)

      expect(screen.getByText('Chatbot')).toBeInTheDocument()
      expect(screen.getByText('Workflow')).toBeInTheDocument()
      expect(screen.getByText('Agent')).toBeInTheDocument()
    })

    it('hides app name and centers content in mobile mode', () => {
      render(<LinkedAppsPanel relatedApps={mockRelatedApps} isMobile={true} />)

      expect(screen.queryByText('Chatbot App')).not.toBeInTheDocument()
      expect(screen.queryByText('Workflow App')).not.toBeInTheDocument()

      const items = screen.getAllByTestId('link-item')
      expect(items[0]).toHaveClass('justify-center')
    })

    it('handles empty relatedApps list gracefully', () => {
      const { container } = render(<LinkedAppsPanel relatedApps={[]} isMobile={false} />)
      const items = screen.queryAllByTestId('link-item')
      expect(items).toHaveLength(0)
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Interaction', () => {
    it('renders correct links for each app', () => {
      render(<LinkedAppsPanel relatedApps={mockRelatedApps} isMobile={false} />)

      const items = screen.getAllByTestId('link-item')
      expect(items[0]).toHaveAttribute('href', '/app/app-1/overview')
      expect(items[1]).toHaveAttribute('href', '/app/app-2/overview')
    })
  })
})
