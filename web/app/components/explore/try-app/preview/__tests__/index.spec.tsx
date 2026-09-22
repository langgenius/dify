import type { TryAppInfo } from '@/service/try-app'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import Preview from '../index'

vi.mock('../basic-app-preview', () => ({
  default: () => <section aria-label="Basic app preview" />,
}))
vi.mock('../flow-app-preview', () => ({
  default: () => <section aria-label="Flow app preview" />,
}))
vi.mock('@/features/agent-v2/trial-preview', () => ({
  AgentTrialPreview: () => <section aria-label="Agent configuration preview" />,
}))

const createApp = (mode: string) => ({ mode }) as TryAppInfo

describe('Preview', () => {
  it.each(['agent-chat', 'chat', 'completion'])('uses the basic preview for %s apps', (mode) => {
    render(<Preview appId="app-id" appDetail={createApp(mode)} />)

    expect(screen.getByRole('region', { name: 'Basic app preview' })).toBeInTheDocument()
  })

  it('uses the published agent configuration preview for new agents', () => {
    render(<Preview appId="app-id" appDetail={createApp('agent')} />)
    expect(screen.getByRole('region', { name: 'Agent configuration preview' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Basic app preview' })).not.toBeInTheDocument()
  })

  it.each(['workflow', 'advanced-chat'])('uses the flow preview for %s apps', (mode) => {
    render(<Preview appId="app-id" appDetail={createApp(mode)} />)

    expect(screen.getByRole('region', { name: 'Flow app preview' })).toBeInTheDocument()
  })
})
