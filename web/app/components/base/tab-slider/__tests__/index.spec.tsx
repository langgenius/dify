import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useInstalledPluginList } from '@/service/use-plugins'
import TabSlider from '../index'

vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: vi.fn(),
}))

const options = [
  { value: 'all', text: 'All' },
  { value: 'plugins', text: 'Plugins' },
]

describe('TabSlider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useInstalledPluginList).mockReturnValue({
      data: { total: 0 },
      isLoading: false,
    } as ReturnType<typeof useInstalledPluginList>)
  })

  it('changes only when users select an inactive tab', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TabSlider value="all" options={options} onChange={onChange} />)

    await user.click(screen.getByText('All'))
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByText('Plugins'))
    expect(onChange).toHaveBeenCalledWith('plugins')
  })

  it('shows the installed plugin count', () => {
    vi.mocked(useInstalledPluginList).mockReturnValue({
      data: { total: 5 },
      isLoading: false,
    } as ReturnType<typeof useInstalledPluginList>)

    render(<TabSlider value="all" options={options} onChange={vi.fn()} />)

    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
