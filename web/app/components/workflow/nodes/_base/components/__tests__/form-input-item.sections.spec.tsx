import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { MultiSelectField } from '../form-input-item.sections'

describe('form-input-item sections', () => {
  it('prevents selecting options while they are loading', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWorkflowComponent(
      <MultiSelectField
        disabled={false}
        isLoading
        items={[{ name: 'Alpha', value: 'alpha' }]}
        onChange={onChange}
        selectedLabel=""
        value={[]}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Options' })
    expect(trigger).toHaveTextContent('Loading')
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits the selected option value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWorkflowComponent(
      <MultiSelectField
        disabled={false}
        items={[
          { name: 'Alpha', value: 'alpha', icon: '/alpha.svg' },
          { name: 'Beta', value: 'beta' },
        ]}
        onChange={onChange}
        placeholder="Choose options"
        selectedLabel=""
        value={[]}
      />,
    )

    expect(screen.getByText('Choose options')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Choose options' }))
    await user.click(await screen.findByRole('option', { name: 'Alpha' }))

    expect(onChange).toHaveBeenCalledWith(['alpha'], expect.anything())
  })
})
