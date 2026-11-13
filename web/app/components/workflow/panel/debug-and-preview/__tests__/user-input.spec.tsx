import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStartNode } from '../../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../../__tests__/workflow-test-env'
import { InputVarType } from '../../../types'
import UserInput from '../user-input'

it('reveals hidden start inputs in debug mode and preserves input values when leaving it', async () => {
  const user = userEvent.setup()
  const { store } = renderWorkflowFlowComponent(<UserInput />, {
    nodes: [
      createStartNode({
        data: {
          variables: [
            { type: InputVarType.textInput, label: 'Query', variable: 'query', required: true },
            {
              type: InputVarType.textInput,
              label: 'Hidden field',
              variable: 'hidden_field',
              required: false,
              hide: true,
            },
          ],
        },
      }),
    ],
    initialStoreState: { showDebugAndPreviewPanel: false, inputs: {} },
  })

  expect(screen.queryByPlaceholderText('Hidden field')).not.toBeInTheDocument()
  await user.type(screen.getByPlaceholderText('Query'), 'hello')
  act(() => store.getState().setShowDebugAndPreviewPanel(true))
  await user.type(screen.getByPlaceholderText('Hidden field'), 'debug value')
  expect(store.getState().inputs).toEqual({ query: 'hello', hidden_field: 'debug value' })

  act(() => store.getState().setShowDebugAndPreviewPanel(false))
  expect(screen.queryByPlaceholderText('Hidden field')).not.toBeInTheDocument()
  expect(screen.getByPlaceholderText('Query')).toHaveValue('hello')
  expect(store.getState().inputs).toEqual({ query: 'hello', hidden_field: 'debug value' })
})
