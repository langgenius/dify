import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { AgentConfigureTipContent } from '../tip-content'

vi.mock('react-i18next', () => ({
  Trans: ({ components }: { components: { docLink: ReactElement } }) => components.docLink,
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test/en/cloud${path}`,
}))

describe('AgentConfigureTipContent', () => {
  it('links environment variables to the New Agent build documentation', () => {
    render(<AgentConfigureTipContent type="env" />)

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://docs.example.test/en/cloud/use-dify/build/new-agent/build#environment-variables',
    )
  })
})
