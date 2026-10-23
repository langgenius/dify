import type { SourceProviderOption } from '../provider-options'
import { fireEvent, screen, within } from '@testing-library/react'
import { render } from '@/test/console/render'
import { SourceProviderIcon, SourceProviderSelector } from '../fields'

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-123' },
  }))
})

describe('source provider icons', () => {
  it('replaces a broken image and retries after switching images, including switching back', () => {
    const { rerender, container } = render(
      <SourceProviderIcon icon="/first.svg" fallbackIcon="i-ri-file-text-line" />,
    )
    fireEvent.error(screen.getByRole('presentation', { hidden: true }))
    expect(screen.queryByRole('presentation', { hidden: true })).not.toBeInTheDocument()
    expect(container.firstElementChild).toBeVisible()

    rerender(<SourceProviderIcon icon="/second.svg" fallbackIcon="i-ri-file-text-line" />)
    expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute('src', '/second.svg')
    rerender(<SourceProviderIcon icon="/first.svg" fallbackIcon="i-ri-file-text-line" />)
    expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute('src', '/first.svg')
  })

  it('uses the plugin image when the datasource image is empty', () => {
    const label = { en_US: 'GitHub Repository', zh_Hans: 'GitHub Repository' }
    const datasource = {
      description: label,
      identity: { author: 'langgenius', icon: '', label, name: 'github', provider: 'github' },
      parameters: [],
    }
    const option: SourceProviderOption = {
      datasource,
      fallbackIcon: 'i-ri-file-text-line',
      key: 'github',
      label: 'GitHub Repository',
      packageId: 'langgenius/github',
      providerType: 'online_document',
      sourceType: 'onlineDocuments',
      plugin: {
        plugin_id: 'langgenius/github',
        plugin_unique_identifier: 'langgenius/github:1.0.0@local',
        provider: 'github',
        is_authorized: false,
        declaration: {
          credentials_schema: [],
          provider_type: 'online_document',
          datasources: [datasource],
          identity: {
            author: 'langgenius',
            description: label,
            icon: 'github.svg',
            label,
            name: 'github',
            tags: [],
          },
        },
      },
    }
    render(<SourceProviderSelector options={[option]} providerKey="github" onChange={vi.fn()} />)
    const image = within(screen.getByRole('radio', { name: 'GitHub Repository' })).getByRole(
      'presentation',
      { hidden: true },
    )
    expect(image.getAttribute('src')).toContain(
      '/workspaces/current/plugin/icon?tenant_id=workspace-123&filename=github.svg',
    )
  })
})
