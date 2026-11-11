import { screen } from '@testing-library/react'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import FormContent from '../form-content'

it('makes the editor readonly and removes input creation', () => {
  renderWorkflowEditor(
    <FormContent
      nodeId="approval"
      value="Review this request"
      readonly
      onChange={vi.fn()}
      formInputs={[]}
      onFormInputsChange={vi.fn()}
      onFormInputItemRename={vi.fn()}
      onFormInputItemRemove={vi.fn()}
      editorKey={1}
      isExpand={false}
      availableVars={[]}
      availableNodes={[]}
    />,
  )
  expect(screen.getByRole('textbox')).toHaveAttribute('contenteditable', 'false')
  expect(screen.queryByRole('button', { name: /insertInputField.insert/ })).not.toBeInTheDocument()
})
