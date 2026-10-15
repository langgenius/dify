import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComparisonOperator } from '../../../../types'
import ConditionItem from '../condition-item'

vi.mock('../condition-variable-selector', () => ({
  default: ({
    valueSelector,
    onChange,
  }: {
    valueSelector: string[]
    onChange: (value: string[]) => void
  }) => <button onClick={() => onChange(['start', 'categoryx'])}>{valueSelector.join('.')}</button>,
}))

it('preserves variable mode and expression encoding on the same mounted row after schema recovery', async () => {
  const condition = {
    id: 'c',
    name: 'category',
    type: 'string' as const,
    comparison_operator: ComparisonOperator.is,
    value: '{{#start.category#}}',
  }
  const update = vi.fn()
  const props = { condition, onUpdateCondition: update, isCommonVariable: false }
  const view = render(<ConditionItem {...props} metadataList={[]} />)
  expect(screen.getByText('{{#start.category#}}')).toBeInTheDocument()
  view.rerender(
    <ConditionItem
      {...props}
      metadataList={[{ id: 'a', name: 'category', type: 'string', value: '' }]}
    />,
  )
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: 'start.category' }))
  expect(update).toHaveBeenLastCalledWith(
    'c',
    expect.objectContaining({ value: '{{#start.categoryx#}}' }),
  )
})

it('resolves a recreated field by retrieval name instead of a renamed stale ID', () => {
  const condition = {
    id: 'c',
    metadata_id: 'old',
    name: 'category',
    type: 'string' as const,
    comparison_operator: ComparisonOperator.is,
    value: 'news',
  }
  render(
    <ConditionItem
      condition={condition}
      metadataList={[
        { id: 'old', name: 'rating', type: 'string', value: '' },
        { id: 'new', name: 'category', type: 'string', value: '' },
      ]}
    />,
  )
  expect(screen.getByText('category')).toBeInTheDocument()
  expect(screen.queryByText('rating')).not.toBeInTheDocument()
})
