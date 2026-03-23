import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GenericTable from '../generic-table'

const columns = [
  {
    key: 'name',
    title: 'Name',
    type: 'input' as const,
    placeholder: 'Name',
    width: 'w-[140px]',
  },
  {
    key: 'enabled',
    title: 'Enabled',
    type: 'switch' as const,
    width: 'w-[80px]',
  },
]

describe('GenericTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render an empty editable row and append a configured row when typing into the virtual row', async () => {
    const onChange = vi.fn()

    render(
      <GenericTable
        title="Headers"
        columns={columns}
        data={[]}
        emptyRowData={{ name: '', enabled: false }}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my key' } })

    expect(onChange).toHaveBeenLastCalledWith([{ name: 'my_key', enabled: false }])
  })

  it('should update existing rows, show delete action, and remove rows by primary key', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <GenericTable
        title="Headers"
        columns={columns}
        data={[{ name: 'alpha', enabled: false }]}
        emptyRowData={{ name: '', enabled: false }}
        onChange={onChange}
        showHeader
      />,
    )

    expect(screen.getByText('Name')).toBeInTheDocument()

    await user.click(screen.getAllByRole('checkbox')[0])
    expect(onChange).toHaveBeenCalledWith([{ name: 'alpha', enabled: true }])

    await user.click(screen.getByRole('button', { name: 'Delete row' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('should show readonly placeholder without rendering editable rows', () => {
    render(
      <GenericTable
        title="Headers"
        columns={columns}
        data={[]}
        emptyRowData={{ name: '', enabled: false }}
        onChange={vi.fn()}
        readonly
        placeholder="No data"
      />,
    )

    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
