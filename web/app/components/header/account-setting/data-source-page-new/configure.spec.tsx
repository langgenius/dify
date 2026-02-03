import type { DataSourceAuth } from './types'
import type { PluginPayload } from '@/app/components/plugins/plugin-auth/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { AuthCategory } from '@/app/components/plugins/plugin-auth/types'
import Configure from './configure'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Mock @remixicon/react
vi.mock('@remixicon/react', () => ({
  RiAddLine: () => <span data-testid="add-icon">Icon</span>,
}))

// Mock Button component
vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}))

// Mock PortalToFollowElem components
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => <div onClick={onClick}>{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock Plugin Auth components
vi.mock('@/app/components/plugins/plugin-auth', () => ({
  AddApiKeyButton: ({ buttonText, onUpdate }: { buttonText: string, onUpdate: () => void }) => <button onClick={onUpdate}>{buttonText}</button>,
  AddOAuthButton: ({ buttonText, onUpdate }: { buttonText: string, onUpdate: () => void }) => <button onClick={onUpdate}>{buttonText}</button>,
}))

describe('Configure', () => {
  const mockItem: DataSourceAuth = {
    plugin_id: 'plugin-1',
    name: 'Plugin 1',
    author: 'author',
    provider: 'provider',
    plugin_unique_identifier: 'plugin-1',
    icon: 'icon',
    label: { en_US: 'Plugin 1', zh_Hans: 'Plugin 1' },
    description: { en_US: 'Description', zh_Hans: 'Description' },
    credentials_list: [],
    credential_schema: [{
      type: FormTypeEnum.textInput,
      name: 'key',
      label: 'Key',
      required: true,
    }],
    oauth_schema: {
      client_schema: [{
        type: FormTypeEnum.textInput,
        name: 'client',
        label: 'Client',
        required: true,
      }],
    },
  }

  const mockPluginPayload: PluginPayload = {
    category: AuthCategory.datasource,
    provider: 'provider',
    providerType: 'datasource',
  }

  const mockOnUpdate = vi.fn()

  it('renders configure button', () => {
    render(<Configure item={mockItem} pluginPayload={mockPluginPayload} />)
    expect(screen.getByText('dataSource.configure')).toBeInTheDocument()
  })

  it('renders API and OAuth buttons when expanded', () => {
    render(<Configure item={mockItem} pluginPayload={mockPluginPayload} />)
    // Because we mocked PortalToFollowElem to simply render children, the content is always visible in the DOM structure for tests
    expect(screen.getByText('auth.addApi')).toBeInTheDocument()
    expect(screen.getByText('auth.addOAuth')).toBeInTheDocument()
  })

  it('handles update callback', () => {
    render(<Configure item={mockItem} pluginPayload={mockPluginPayload} onUpdate={mockOnUpdate} />)
    fireEvent.click(screen.getByText('dataSource.configure')) // Open
    fireEvent.click(screen.getByText('auth.addApi')) // Click action
    expect(mockOnUpdate).toHaveBeenCalled()
  })

  it('renders only OAuth button when only OAuth is available', () => {
    const itemOnlyOAuth = { ...mockItem, credential_schema: [] }
    render(<Configure item={itemOnlyOAuth} pluginPayload={mockPluginPayload} />)
    expect(screen.queryByText('auth.addApi')).not.toBeInTheDocument()
    expect(screen.getByText('auth.addOAuth')).toBeInTheDocument()
  })

  it('renders only API Key button when only API Key is available', () => {
    const itemOnlyApiKey: DataSourceAuth = { ...mockItem, oauth_schema: undefined }
    render(<Configure item={itemOnlyApiKey} pluginPayload={mockPluginPayload} />)
    expect(screen.getByText('auth.addApi')).toBeInTheDocument()
    expect(screen.queryByText('auth.addOAuth')).not.toBeInTheDocument()
  })
})
