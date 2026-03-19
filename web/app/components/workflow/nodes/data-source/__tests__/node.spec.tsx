import type { DataSourceNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { useNodePluginInstallation } from '@/app/components/workflow/hooks/use-node-plugin-installation'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const mockInstallPluginButton = vi.hoisted(() => vi.fn(({ uniqueIdentifier }: { uniqueIdentifier: string }) => (
  <button type="button">{uniqueIdentifier}</button>
)))

vi.mock('@/app/components/workflow/hooks/use-node-plugin-installation', () => ({
  useNodePluginInstallation: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/install-plugin-button', () => ({
  InstallPluginButton: mockInstallPluginButton,
}))

const mockUseNodePluginInstallation = vi.mocked(useNodePluginInstallation)

const createNodeData = (overrides: Partial<DataSourceNodeType> = {}): DataSourceNodeType => ({
  title: 'Datasource',
  desc: '',
  type: BlockEnum.DataSource,
  plugin_id: 'plugin-id',
  provider_type: 'datasource',
  provider_name: 'file',
  datasource_name: 'local-file',
  datasource_label: 'Local File',
  datasource_parameters: {},
  datasource_configurations: {},
  plugin_unique_identifier: 'plugin-id@1.0.0',
  ...overrides,
})

describe('DataSourceNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodePluginInstallation.mockReturnValue({
      isChecking: false,
      isMissing: false,
      uniqueIdentifier: undefined,
      canInstall: false,
      onInstallSuccess: vi.fn(),
      shouldDim: false,
    })
  })

  // The node should only expose install affordances when the backing plugin is missing and installable.
  describe('Plugin Installation', () => {
    it('should render the install button when the datasource plugin is missing', () => {
      mockUseNodePluginInstallation.mockReturnValue({
        isChecking: false,
        isMissing: true,
        uniqueIdentifier: 'plugin-id@1.0.0',
        canInstall: true,
        onInstallSuccess: vi.fn(),
        shouldDim: true,
      })

      render(<Node id="data-source-node" data={createNodeData()} />)

      expect(screen.getByRole('button', { name: 'plugin-id@1.0.0' })).toBeInTheDocument()
      expect(mockInstallPluginButton).toHaveBeenCalledWith(expect.objectContaining({
        uniqueIdentifier: 'plugin-id@1.0.0',
        extraIdentifiers: ['plugin-id', 'file'],
      }), undefined)
    })

    it('should render nothing when installation is unavailable', () => {
      const { container } = render(<Node id="data-source-node" data={createNodeData()} />)

      expect(container).toBeEmptyDOMElement()
    })
  })
})
