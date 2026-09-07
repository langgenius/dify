import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DataSourceOptions from '../index'

const options = [
  { value: 'website', label: 'Website', data: { title: 'Website' } },
  { value: 'drive', label: 'Drive', data: { title: 'Drive' } },
]

vi.mock('../../hooks', () => ({
  useDatasourceOptions: () => options,
}))

vi.mock('../option-card', () => ({
  default: ({
    label,
    value,
    onClick,
  }: {
    label: string
    value: string
    onClick: (value: string) => void
  }) => (
    <button type="button" onClick={() => onClick(value)}>
      {label}
    </button>
  ),
}))

describe('DataSourceOptions', () => {
  it('selects the first datasource when no selection exists', () => {
    const onSelect = vi.fn()

    render(<DataSourceOptions dataSourceNodeId="" onSelect={onSelect} />)

    expect(onSelect).toHaveBeenCalledWith({ nodeId: 'website', nodeData: options[0]!.data })
  })

  it('selects the datasource chosen by the user', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<DataSourceOptions dataSourceNodeId="website" onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Drive' }))

    expect(onSelect).toHaveBeenCalledWith({ nodeId: 'drive', nodeData: options[1]!.data })
  })
})
