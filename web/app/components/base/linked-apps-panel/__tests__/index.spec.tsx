import { render, screen, within } from '@testing-library/react'
import LinkedAppsPanel from '../index'

describe('LinkedAppsPanel Component', () => {
  const mockRelatedApps = [
    {
      id: 'app-1',
      name: 'Chatbot App',
      description: '',
      mode: 'chat' as const,
      icon_type: 'emoji' as const,
      icon: '🤖',
      icon_background: '#FFEAD5',
      icon_url: '',
    },
    {
      id: 'app-2',
      name: 'Workflow App',
      description: '',
      mode: 'workflow' as const,
      icon_type: 'image' as const,
      icon: 'file-id',
      icon_background: '#E4FBCC',
      icon_url: 'https://example.com/icon.png',
    },
    {
      id: 'app-3',
      name: '',
      description: '',
      mode: 'agent-chat' as const,
      icon_type: 'emoji' as const,
      icon: '🕵️',
      icon_background: '#D3F8DF',
      icon_url: '',
    },
  ]

  it('links each related application to its overview with its name and mode', () => {
    render(<LinkedAppsPanel relatedApps={mockRelatedApps} isMobile={false} />)
    for (const [name, mode, id] of [
      ['Chatbot App', 'Chatbot', 'app-1'],
      ['Workflow App', 'Workflow', 'app-2'],
      ['--', 'Agent', 'app-3'],
    ]) {
      const link = screen.getByRole('link', { name: new RegExp(name!) })
      expect(link).toHaveAttribute('href', `/app/${id}/overview`)
      expect(within(link).getByText(mode!)).toBeInTheDocument()
    }
  })
})
