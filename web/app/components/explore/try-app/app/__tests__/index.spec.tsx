import type { TryAppInfo } from '@/service/try-app'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import TryApp from '../index'

vi.mock('../chat', () => ({
  default: () => <section aria-label="Chat preview" />,
}))
vi.mock('../text-generation', () => ({
  default: ({ isWorkflow }: { isWorkflow: boolean }) => (
    <section aria-label={isWorkflow ? 'Workflow preview' : 'Completion preview'} />
  ),
}))

const createApp = (mode: string): TryAppInfo =>
  ({
    id: 'app-id',
    mode,
    site: { title: 'Try App' },
  }) as TryAppInfo

describe('TryApp', () => {
  it.each(['chat', 'advanced-chat', 'agent-chat'])(
    'uses the chat experience for %s apps',
    (mode) => {
      render(<TryApp appId="app-id" appDetail={createApp(mode)} />)

      expect(screen.getByRole('region', { name: 'Chat preview' })).toBeInTheDocument()
    },
  )

  it.each([
    ['completion', 'Completion preview'],
    ['workflow', 'Workflow preview'],
  ])('uses the text generation experience for %s apps', (mode, name) => {
    render(<TryApp appId="app-id" appDetail={createApp(mode)} />)

    expect(screen.getByRole('region', { name })).toBeInTheDocument()
  })

  it('preserves document title ownership for the underlying route', () => {
    document.title = 'Apps - Dify'

    render(<TryApp appId="app-id" appDetail={createApp('chat')} />)

    expect(document.title).toBe('Apps - Dify')
  })
})
