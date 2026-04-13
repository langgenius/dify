import type { StartNodeType } from '../../../nodes/start/types'
import { fireEvent, screen } from '@testing-library/react'
import { renderWorkflowComponent } from '../../../__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '../../../types'
import UserInput from '../user-input'

const runtimeNodes = vi.hoisted(() => [] as Array<{ data: StartNodeType }>)

vi.mock('reactflow', () => ({
  useNodes: () => runtimeNodes,
}))

const createStartNodeData = (variables: StartNodeType['variables']): StartNodeType => ({
  title: 'Start',
  desc: '',
  type: BlockEnum.Start,
  variables,
})

describe('debug-and-preview UserInput', () => {
  beforeEach(() => {
    runtimeNodes.length = 0
  })

  it('returns null when no visible variables remain', () => {
    runtimeNodes.push({
      data: createStartNodeData([
        {
          type: InputVarType.textInput,
          label: 'Hidden field',
          variable: 'hidden_field',
          required: false,
          hide: true,
        },
      ]),
    })

    const { container } = renderWorkflowComponent(<UserInput />, {
      initialStoreState: {
        showDebugAndPreviewPanel: false,
      },
      hooksStoreProps: {},
    })

    expect(container.firstChild).toBeNull()
  })

  it('renders start variables and writes updates back to the workflow store', () => {
    runtimeNodes.push({
      data: createStartNodeData([
        {
          type: InputVarType.textInput,
          label: 'Query',
          variable: 'query',
          required: true,
        },
        {
          type: InputVarType.textInput,
          label: 'Hidden field',
          variable: 'hidden_field',
          required: false,
          hide: true,
        },
      ]),
    })

    const { store } = renderWorkflowComponent(<UserInput />, {
      initialStoreState: {
        showDebugAndPreviewPanel: true,
        inputs: {},
      },
      hooksStoreProps: {},
    })

    fireEvent.change(screen.getByPlaceholderText('Query'), { target: { value: 'hello' } })

    expect(screen.getByPlaceholderText('Hidden field')).toBeInTheDocument()
    expect(store.getState().inputs).toEqual({
      query: 'hello',
    })
  })
})
