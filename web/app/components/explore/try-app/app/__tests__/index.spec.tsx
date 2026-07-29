import type { TryAppInfo } from '@/service/try-app'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useDocumentTitle from '@/hooks/use-document-title'
import TryApp from '../index'

vi.mock('@/hooks/use-document-title', () => ({ default: vi.fn() }))
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

  it('sets the document title from the shared app metadata', () => {
    render(<TryApp appId="app-id" appDetail={createApp('chat')} />)

    expect(useDocumentTitle).toHaveBeenCalledWith('Try App')
  })
})
