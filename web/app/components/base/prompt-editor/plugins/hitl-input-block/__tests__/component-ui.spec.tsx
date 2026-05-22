import type { ComponentProps } from 'react'
import type { WorkflowNodesMap } from '../../workflow-variable-block/node'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { ValueSelector } from '@/app/components/workflow/types'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import HITLInputComponentUI from '../component-ui'
import { HITLInputNode } from '../node'

const createFormInput = (overrides?: Partial<FormInputItem>): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'customer_name',
  default: {
    type: 'constant',
    selector: [],
    value: 'John Doe',
  },
  ...overrides,
})

const createWorkflowNodesMap = (): WorkflowNodesMap => ({
  'node-2': {
    title: 'Node 2',
    type: BlockEnum.LLM,
    height: 100,
    width: 120,
    position: { x: 0, y: 0 },
  },
})

const renderComponent = (
  props: Partial<ComponentProps<typeof HITLInputComponentUI>> = {},
) => {
  const onChange = vi.fn()
  const onRename = vi.fn()
  const onRemove = vi.fn()

  const defaultProps: ComponentProps<typeof HITLInputComponentUI> = {
    nodeId: 'node-1',
    varName: 'customer_name',
    workflowNodesMap: createWorkflowNodesMap(),
    onChange,
    onRename,
    onRemove,
    ...props,
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: `hitl-input-test-${crypto.randomUUID()}`,
        onError: (error: Error) => {
          throw error
        },
        nodes: [HITLInputNode],
      }}
    >
      <HITLInputComponentUI {...defaultProps} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    onChange,
    onRename,
    onRemove,
  }
}

describe('HITLInputComponentUI', () => {
  const varName = 'customer_name'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render action buttons correctly', () => {
      renderComponent()

      expect(screen.getByRole('button', { name: 'common.operation.edit' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.remove' })).toBeInTheDocument()
    })

    it('should render variable block when default type is variable', () => {
      const selector = ['node-2', 'answer'] as ValueSelector

      const { getByText } = renderComponent({
        formInput: createFormInput({
          default: {
            type: 'variable',
            selector,
            value: '',
          },
        }),
      })

      expect(getByText('Node 2')).toBeInTheDocument()
      expect(getByText('answer')).toBeInTheDocument()
    })

    it('should hide action buttons when readonly is true', () => {
      renderComponent({ readonly: true })

      expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
    })
  })

  describe('Remove action', () => {
    it('should call onRemove when remove button is clicked', () => {
      const { onRemove } = renderComponent()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.remove' }))

      expect(onRemove).toHaveBeenCalledWith(varName)
      expect(onRemove).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edit flow', () => {
    it('should close modal without update when cancel is clicked', async () => {
      const {
        findByRole,
        queryByRole,
        onChange,
        onRename,
      } = renderComponent()

      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.edit' }))

      await findByRole('textbox')

      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))

      expect(onChange).not.toHaveBeenCalled()
      expect(onRename).not.toHaveBeenCalled()

      expect(queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  describe('Default formInput', () => {
    it('should pass default payload to InputField when formInput is undefined', async () => {
      const { findByRole } = renderComponent({
        formInput: undefined,
      })

      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.edit' }))

      const textbox = await findByRole('textbox')

      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.save' }))

      expect(textbox).toHaveValue('customer_name')
    })

    it('should render variable selector when workflowNodesMap fallback is used', () => {
      const { getByText } = renderComponent({
        workflowNodesMap: undefined as unknown as WorkflowNodesMap,
        formInput: createFormInput({
          default: {
            type: 'variable',
            selector: ['node-2', 'answer'] as ValueSelector,
            value: '',
          },
        }),
      })

      expect(getByText('answer')).toBeInTheDocument()
    })
  })
})
