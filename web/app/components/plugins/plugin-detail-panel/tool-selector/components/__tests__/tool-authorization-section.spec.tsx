import type { ToolWithProvider } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CollectionType } from '@/app/components/tools/types'
import ToolAuthorizationSection from '../tool-authorization-section'

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AuthCategory: {
    tool: 'tool',
  },
  PluginAuthInAgent: ({ pluginPayload, credentialId }: {
    pluginPayload: { provider: string, providerType: string }
    credentialId?: string
  }) => (
    <div data-testid="plugin-auth-in-agent">
      {pluginPayload.provider}
      :
      {pluginPayload.providerType}
      :
      {credentialId}
    </div>
  ),
}))

const createProvider = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider => ({
  name: 'provider-a',
  type: CollectionType.builtIn,
  allow_delete: true,
  ...overrides,
}) as ToolWithProvider

describe('ToolAuthorizationSection', () => {
  it('returns null for providers that are not removable built-ins', () => {
    const { container, rerender } = render(
      <ToolAuthorizationSection
        currentProvider={createProvider({ type: CollectionType.custom })}
        onAuthorizationItemClick={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()

    rerender(
      <ToolAuthorizationSection
        currentProvider={createProvider({ allow_delete: false })}
        onAuthorizationItemClick={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the authorization panel for removable built-in providers', () => {
    render(
      <ToolAuthorizationSection
        currentProvider={createProvider()}
        credentialId="credential-1"
        onAuthorizationItemClick={vi.fn()}
      />,
    )

    expect(screen.getByTestId('plugin-auth-in-agent')).toHaveTextContent('provider-a:builtin:credential-1')
  })
})
