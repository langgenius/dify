import type { Dependency } from '@/app/components/plugins/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PluginDependency from '../index'
import { useStore } from '../store'

vi.mock('@/app/components/plugins/install-plugin/install-bundle', () => ({
  __esModule: true,
  default: ({
    fromDSLPayload,
    onClose,
  }: {
    fromDSLPayload: Dependency[]
    onClose: () => void
  }) => (
    <div>
      <div>{`bundle-size:${fromDSLPayload.length}`}</div>
      <button type="button" onClick={onClose}>close-bundle</button>
    </div>
  ),
}))

const createDependency = (): Dependency => ({
  type: 'marketplace',
  value: {
    organization: 'langgenius',
    plugin: 'sample-plugin',
    version: '1.0.0',
    plugin_unique_identifier: 'langgenius/sample-plugin:1.0.0',
  },
})

describe('plugin-dependency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({
      dependencies: [],
    })
  })

  it('should render nothing when there are no dependencies to install', () => {
    render(<PluginDependency />)

    expect(screen.queryByText(/bundle-size/i)).not.toBeInTheDocument()
  })

  it('should render the install bundle and clear dependencies when closed', async () => {
    const user = userEvent.setup()
    useStore.setState({
      dependencies: [createDependency()],
    })

    render(<PluginDependency />)

    expect(screen.getByText('bundle-size:1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'close-bundle' }))

    expect(useStore.getState().dependencies).toEqual([])
  })

  it('should update dependencies through the store setter', () => {
    const dependency = createDependency()

    useStore.getState().setDependencies([dependency])

    expect(useStore.getState().dependencies).toEqual([dependency])
  })
})
