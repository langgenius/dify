import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Actions from '../index'

vi.mock('@/next/navigation', () => ({ useParams: () => ({ datasetId: 'dataset-1' }) }))

it('returns to the current dataset documents when canceled', () => {
  render(<Actions handleNextStep={vi.fn()} />)
  expect(screen.getByRole('link', { name: 'common.operation.cancel' })).toHaveAttribute(
    'href',
    '/datasets/dataset-1/documents',
  )
})

it.each([false, true])('gates advancing to the next step when disabled=%s', async (disabled) => {
  const user = userEvent.setup()
  const handleNextStep = vi.fn()
  render(<Actions handleNextStep={handleNextStep} disabled={disabled} />)
  await user.click(screen.getByRole('button', { name: 'datasetCreation.stepOne.button' }))
  expect(handleNextStep).toHaveBeenCalledTimes(disabled ? 0 : 1)
})

it.each([
  [0, 'false', true],
  [3, 'mixed', true],
  [5, 'true', false],
])(
  'represents %s selected items and requests the corresponding bulk action',
  async (selectedOptions, checked, nextValue) => {
    const user = userEvent.setup()
    const onSelectAll = vi.fn()
    render(
      <Actions
        handleNextStep={vi.fn()}
        showSelect
        totalOptions={5}
        selectedOptions={selectedOptions}
        onSelectAll={onSelectAll}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'common.operation.selectAll' })
    expect(checkbox).toHaveAttribute('aria-checked', checked)
    await user.click(checkbox)
    expect(onSelectAll).toHaveBeenCalledExactlyOnceWith(nextValue)
  },
)
