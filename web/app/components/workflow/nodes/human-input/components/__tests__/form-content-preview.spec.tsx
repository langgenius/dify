import type { FormInputItem } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../../../__tests__/fixtures'
import { renderWorkflowComponent } from '../../../../__tests__/workflow-test-env'
import { InputVarType } from '../../../../types'
import { UserActionButtonType } from '../../types'
import FormContentPreview from '../form-content-preview'

function renderPreview(input: FormInputItem) {
  const onClose = vi.fn()
  renderWorkflowComponent(
    <FormContentPreview
      content={'Source {{#node-1.answer#}}\n\n{{#$output.field_1#}}\n\n{{#$output.missing_field#}}'}
      formInputs={[input]}
      userActions={[
        { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
      ]}
      onClose={onClose}
    />,
    { initialStoreState: { nodes: [createNode({ id: 'node-1', data: { title: 'Classifier' } })] } },
  )
  return onClose
}

it('renders actual markdown variables and input notes with node names and closes the preview', async () => {
  const user = userEvent.setup()
  const onClose = renderPreview({
    type: InputVarType.paragraph,
    output_variable_name: 'field_1',
    default: { type: 'variable', selector: ['node-1', 'result'], value: '' },
  })
  expect(await screen.findByText('{{Classifier/answer}}')).toBeInTheDocument()
  expect(await screen.findByText('{{Classifier/result}}')).toBeInTheDocument()
  expect(await screen.findByText(/Can't find note:missing_field/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('resolves the variable supplying select options in an input note', async () => {
  renderPreview({
    type: InputVarType.select,
    output_variable_name: 'field_1',
    option_source: { type: 'variable', selector: ['node-1', 'items'], value: [] },
  })
  expect(await screen.findByText('{{Classifier/items}}')).toBeInTheDocument()
})
