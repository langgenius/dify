import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParamType } from '../../../types'
import { ExtractParameterList } from '../list'

const parameter = { name: 'city', type: ParamType.string, description: 'City name', required: true }

describe('ExtractParameterList', () => {
  it('exposes named edit and delete actions for each parameter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ExtractParameterList readonly={false} list={[parameter]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.edit city' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'common.operation.delete city' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith([])
  })

  it('opens the remaining parameter without a canceled draft after another row is deleted', async () => {
    const user = userEvent.setup()
    const country = { ...parameter, name: 'country', description: 'Country name' }
    const onChange = vi.fn()
    const { rerender } = render(
      <ExtractParameterList readonly={false} list={[parameter, country]} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.edit country' }))
    await user.type(screen.getByRole('textbox', { name: /Content.name$/ }), '_draft')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'common.operation.delete city' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith([country])
    rerender(<ExtractParameterList readonly={false} list={[country]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'common.operation.edit country' }))
    expect(screen.getByRole('textbox', { name: /Content.name$/ })).toHaveValue('country')
    expect(screen.getByRole('textbox', { name: /Content.description$/ })).toHaveValue(
      'Country name',
    )
  })

  it('does not expose editing or deletion in readonly mode', () => {
    render(<ExtractParameterList readonly list={[parameter]} onChange={vi.fn()} />)
    expect(screen.getByText('City name')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
