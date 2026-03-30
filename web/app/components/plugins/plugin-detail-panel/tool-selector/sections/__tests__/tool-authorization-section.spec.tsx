import type { ToolWithProvider } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import ToolAuthorizationSection from '../tool-authorization-section'

const mockPluginAuthInAgent = vi.fn(({
  credentialId,
  onAuthorizationItemClick,
}: {
  credentialId?: string
  onAuthorizationItemClick?: (id: string) => void
}) => (
  <div data-testid="plugin-auth-in-agent">
    <span>{credentialId ?? 'no-credential'}</span>
    <button onClick={() => onAuthorizationItemClick?.('credential-1')}>Select Credential</button>
  </div>
))

vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AuthCategory: { tool: 'tool' },
  PluginAuthInAgent: (props: {
    credentialId?: string
    onAuthorizationItemClick?: (id: string) => void
  }) => mockPluginAuthInAgent(props),
}))

const createProvider = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider => ({
  name: 'builtin-provider',
  type: CollectionType.builtIn,
  allow_delete: true,
  is_team_authorization: true,
  ...overrides,
} as ToolWithProvider)

describe('sections/tool-authorization-section', () => {
  it('should render nothing when provider is missing', () => {
    const { container } = render(<ToolAuthorizationSection />)

    expect(container).toBeEmptyDOMElement()
  })

  it('should render nothing for non built-in providers or providers without delete permission', () => {
    const { rerender, container } = render(
      <ToolAuthorizationSection currentProvider={createProvider({ type: CollectionType.custom })} />,
    )

    expect(container).toBeEmptyDOMElement()

    rerender(
      <ToolAuthorizationSection currentProvider={createProvider({ allow_delete: false })} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('should render divider and auth component for supported providers', () => {
    render(
      <ToolAuthorizationSection
        currentProvider={createProvider()}
        credentialId="credential-123"
        onAuthorizationItemClick={vi.fn()}
      />,
    )

    expect(screen.getByTestId('divider')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-auth-in-agent')).toHaveTextContent('credential-123')
  })

  it('should hide divider when noDivider is true and forward authorization clicks', () => {
    const onAuthorizationItemClick = vi.fn()

    render(
      <ToolAuthorizationSection
        currentProvider={createProvider()}
        noDivider
        onAuthorizationItemClick={onAuthorizationItemClick}
      />,
    )

    expect(screen.queryByTestId('divider')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select Credential' }))

    expect(onAuthorizationItemClick).toHaveBeenCalledWith('credential-1')
  })
})
