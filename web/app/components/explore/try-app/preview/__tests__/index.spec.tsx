import type { TrialAppDetailResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import Preview from '../index'

vi.mock('../basic-app-preview', () => ({
  default: () => <section aria-label="Basic app preview" />,
}))
vi.mock('../flow-app-preview', () => ({
  default: () => <section aria-label="Flow app preview" />,
}))

const createApp = (mode: string) => ({ mode }) as TrialAppDetailResponse

describe('Preview', () => {
  it.each(['agent-chat', 'chat', 'completion'])('uses the basic preview for %s apps', (mode) => {
    render(<Preview appId="app-id" appDetail={createApp(mode)} />)

    expect(screen.getByRole('region', { name: 'Basic app preview' })).toBeInTheDocument()
  })

  it.each(['workflow', 'advanced-chat'])('uses the flow preview for %s apps', (mode) => {
    render(<Preview appId="app-id" appDetail={createApp(mode)} />)

    expect(screen.getByRole('region', { name: 'Flow app preview' })).toBeInTheDocument()
  })
})
