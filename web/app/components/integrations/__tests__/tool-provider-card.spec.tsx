import type { Collection } from '@/app/components/tools/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import IntegrationsToolProviderCard from '../tool-provider-card'

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number, ns?: string }) => options?.ns ? `${options.ns}.${key}${options.count ? `:${options.count}` : ''}` : key,
  }),
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: () => <div data-testid="card-icon" />,
}))

vi.mock('@/app/components/plugins/card/base/corner-mark', () => ({
  default: ({ text }: { text: string }) => <div data-testid="corner-mark">{text}</div>,
}))

const createCollection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 'builtin-provider',
  name: 'builtin-provider',
  author: 'Dify',
  description: { en_US: 'Builtin provider description', zh_Hans: 'Builtin provider description' },
  icon: '',
  label: { en_US: 'Builtin Provider', zh_Hans: 'Builtin Provider' },
  type: 'builtin',
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  tools: [],
  ...overrides,
})

describe('IntegrationsToolProviderCard', () => {
  it('shows a built-in corner badge for builtin tools', () => {
    render(<IntegrationsToolProviderCard collection={createCollection()} />)

    expect(screen.getByTestId('corner-mark')).toHaveTextContent('dataset.metadata.datasetMetadata.builtIn')
  })

  it('does not show a source label for builtin tools', () => {
    render(<IntegrationsToolProviderCard collection={createCollection()} />)

    expect(screen.queryByText('plugin.from')).not.toBeInTheDocument()
  })

  it('does not show a built-in corner badge for marketplace plugin tools', () => {
    render(<IntegrationsToolProviderCard collection={createCollection({ plugin_id: 'author/provider' })} />)

    expect(screen.queryByTestId('corner-mark')).not.toBeInTheDocument()
  })

  it('shows the built-in tool count without using endpoint copy', () => {
    render(
      <IntegrationsToolProviderCard collection={createCollection({
        tools: [
          { name: 'tool-a' },
          { name: 'tool-b' },
        ] as Collection['tools'],
      })}
      />,
    )

    expect(screen.getByText('tools.mcp.toolsCount:2')).toBeInTheDocument()
    expect(screen.queryByText(/plugin\.endpointsEnabled/)).not.toBeInTheDocument()
  })
})
