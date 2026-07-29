import type { TryAppInfo } from '@/service/try-app'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useDocumentTitle from '@/hooks/use-document-title'
import TryApp from '../index'

vi.mock('@/hooks/use-document-title', () => ({ default: vi.fn() }))
vi.mock('../chat', () => ({
  default: ({ trialLimit }: { trialLimit?: number | null }) => (
    <section aria-label="Chat preview" data-trial-limit={trialLimit} />
  ),
}))
vi.mock('../text-generation', () => ({
  default: ({ isWorkflow, trialLimit }: { isWorkflow: boolean; trialLimit?: number | null }) => (
    <section
      aria-label={isWorkflow ? 'Workflow preview' : 'Completion preview'}
      data-trial-limit={trialLimit}
    />
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
      render(<TryApp appId="app-id" appDetail={createApp(mode)} trialLimit={3} />)

      expect(screen.getByRole('region', { name: 'Chat preview' })).toHaveAttribute(
        'data-trial-limit',
        '3',
      )
    },
  )

  it.each([
    ['completion', 'Completion preview'],
    ['workflow', 'Workflow preview'],
  ])('uses the text generation experience for %s apps', (mode, name) => {
    render(<TryApp appId="app-id" appDetail={createApp(mode)} trialLimit={3} />)

    expect(screen.getByRole('region', { name })).toHaveAttribute('data-trial-limit', '3')
  })

  it('sets the document title from the shared app metadata', () => {
    render(<TryApp appId="app-id" appDetail={createApp('chat')} />)

    expect(useDocumentTitle).toHaveBeenCalledWith('Try App')
  })
})
