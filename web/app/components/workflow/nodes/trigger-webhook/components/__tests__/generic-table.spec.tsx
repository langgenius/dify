import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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

const advancedColumns = [
  {
    key: 'method',
    title: 'Method',
    type: 'select' as const,
    placeholder: 'Choose method',
    options: [{ name: 'POST', value: 'post' }],
    width: 'w-[120px]',
  },
  {
    key: 'preview',
    title: 'Preview',
    type: 'custom' as const,
    width: 'w-[120px]',
    render: (_value: unknown, row: { method?: string }, index: number, onChange: (value: unknown) => void) => (
      <button type="button" onClick={() => onChange(`${index}:${row.method || 'empty'}`)}>
        custom-render
      </button>
    ),
  },
  {
    key: 'unsupported',
    title: 'Unsupported',
    type: 'unsupported' as never,
    width: 'w-[80px]',
  },
]

describe('GenericTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  const selectOption = async (triggerName: string, optionName: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: triggerName }))
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: optionName }))
    })
  }

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

  it('should skip intermediate empty rows and blur-sm the current input when enter is pressed', () => {
    render(
      <GenericTable
        title="Headers"
        columns={columns}
        data={[
          { name: 'alpha', enabled: false },
          { name: '', enabled: false },
          { name: 'beta', enabled: true },
        ]}
        emptyRowData={{ name: '', enabled: false }}
        onChange={vi.fn()}
      />,
    )

    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Delete row' })).toHaveLength(2)

    const blurSpy = vi.spyOn(inputs[0]!, 'blur')
    fireEvent.keyDown(inputs[0]!, { key: 'Enter' })
    expect(blurSpy).toHaveBeenCalledTimes(1)
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

    expect(screen.getByText('Name'))!.toBeInTheDocument()

    await user.click(screen.getAllByRole('checkbox')[0]!)
    expect(onChange).toHaveBeenCalledWith([{ name: 'alpha', enabled: true }])

    await user.click(screen.getByRole('button', { name: 'Delete row' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('should update select and custom cells for existing rows', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    const ControlledTable = () => {
      const [data, setData] = useState([{ method: '', preview: '' }])

      return (
        <GenericTable
          title="Advanced"
          columns={advancedColumns}
          data={data}
          emptyRowData={{ method: '', preview: '' }}
          onChange={(nextData) => {
            onChange(nextData)
            setData(nextData as { method: string, preview: string }[])
          }}
        />
      )
    }

    render(
      <ControlledTable />,
    )

    await selectOption('Choose method', 'POST')

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{ method: 'post', preview: '' }])
      expect(screen.getByRole('button', { name: 'POST' }))!.toBeInTheDocument()
    })

    onChange.mockClear()
    await user.click(screen.getAllByRole('button', { name: 'custom-render' })[0]!)

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([{ method: 'post', preview: '0:post' }])
    })
  })

  it('should ignore custom-cell updates when readonly rows are rendered', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <GenericTable
        title="Advanced"
        columns={advancedColumns}
        data={[{ method: 'post', preview: '' }]}
        emptyRowData={{ method: '', preview: '' }}
        onChange={onChange}
        readonly
      />,
    )

    await user.click(screen.getByRole('button', { name: 'custom-render' }))

    expect(onChange).not.toHaveBeenCalled()
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

    expect(screen.getByText('No data'))!.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
