import type { ComponentProps } from 'react'
import type { WorkflowNodesMap } from '../../workflow-variable-block/node'
import type { FormInputItem, ParagraphFormInput } from '@/app/components/workflow/nodes/human-input/types'
import type { ValueSelector } from '@/app/components/workflow/types'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import HITLInputComponentUI from '../component-ui'
import { HITLInputNode } from '../node'

const createParagraphFormInput = (overrides?: Partial<ParagraphFormInput>): ParagraphFormInput => ({
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
        formInput: createParagraphFormInput({
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

    it('should close the edit modal when readonly becomes true', async () => {
      let setReadonlyValue: ((readonly: boolean) => void) | undefined
      const Harness = () => {
        const [readonly, setReadonly] = useState(false)
        const [namespace] = useState(() => `hitl-input-test-${crypto.randomUUID()}`)

        useEffect(() => {
          setReadonlyValue = setReadonly
          return () => {
            setReadonlyValue = undefined
          }
        }, [])

        return (
          <LexicalComposer
            initialConfig={{
              namespace,
              onError: (error: Error) => {
                throw error
              },
              nodes: [HITLInputNode],
            }}
          >
            <HITLInputComponentUI
              nodeId="node-1"
              varName="customer_name"
              workflowNodesMap={createWorkflowNodesMap()}
              onChange={vi.fn()}
              onRename={vi.fn()}
              onRemove={vi.fn()}
              readonly={readonly}
            />
          </LexicalComposer>
        )
      }

      render(<Harness />)

      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.edit' }))

      expect(await screen.findByRole('textbox')).toBeInTheDocument()

      act(() => {
        setReadonlyValue?.(true)
      })

      await waitFor(() => {
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      })
    })

    it('should render select option summary for constant options', () => {
      const { getByText } = renderComponent({
        formInput: {
          type: InputVarType.select,
          output_variable_name: 'customer_name',
          option_source: {
            type: 'constant',
            selector: [],
            value: ['alpha', 'beta'],
          },
        } satisfies FormInputItem,
      })

      expect(getByText('alpha, beta')).toBeInTheDocument()
    })

    it('should render input type label after the summary content', () => {
      const { getByText } = renderComponent({
        formInput: {
          type: InputVarType.select,
          output_variable_name: 'customer_name',
          option_source: {
            type: 'constant',
            selector: [],
            value: ['alpha', 'beta'],
          },
        } satisfies FormInputItem,
      })

      const summary = getByText('alpha, beta')
      const typeLabel = getByText('appDebug.variableConfig.select')

      expect(summary.compareDocumentPosition(typeLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('should render file-list placeholder instead of selected file details', () => {
      const { getAllByText, queryByText } = renderComponent({
        formInput: {
          type: InputVarType.multiFiles,
          output_variable_name: 'customer_name',
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file],
          number_limits: 4,
        } satisfies FormInputItem,
      })

      expect(getAllByText('appDebug.variableConfig.multi-files')).toHaveLength(2)
      expect(queryByText(/document/)).not.toBeInTheDocument()
      expect(queryByText(/4/)).not.toBeInTheDocument()
    })

    it('should render single-file placeholder instead of selected file details', () => {
      const { getAllByText, queryByText } = renderComponent({
        formInput: {
          type: InputVarType.singleFile,
          output_variable_name: 'customer_name',
          allowed_file_extensions: ['.pdf'],
          allowed_file_types: [SupportUploadFileTypes.document],
          allowed_file_upload_methods: [TransferMethod.local_file],
        } satisfies FormInputItem,
      })

      expect(getAllByText('appDebug.variableConfig.single-file')).toHaveLength(2)
      expect(queryByText(/document/)).not.toBeInTheDocument()
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

    it('should prevent renaming to an existing variable name', async () => {
      const {
        findByRole,
        onChange,
        onRename,
      } = renderComponent({
        unavailableVariableNames: ['existing_name'],
      })

      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.edit' }))

      const textbox = await findByRole('textbox')
      fireEvent.change(textbox, { target: { value: 'existing_name' } })

      expect(screen.getByText('workflow.nodes.humanInput.insertInputField.variableNameDuplicated')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onChange).not.toHaveBeenCalled()
      expect(onRename).not.toHaveBeenCalled()
    })
  })

  describe('Default formInput', () => {
    it('should open an empty default editor when formInput is undefined', async () => {
      const { findByRole } = renderComponent({
        formInput: undefined,
      })

      fireEvent.click(await screen.findByRole('button', { name: 'common.operation.edit' }))

      const textbox = await findByRole('textbox')
      const saveButton = await screen.findByRole('button', { name: 'common.operation.save' })

      expect(textbox).toHaveValue('')
      expect(saveButton).toBeDisabled()
    })

    it('should render variable selector when workflowNodesMap fallback is used', () => {
      const { getByText } = renderComponent({
        workflowNodesMap: undefined as unknown as WorkflowNodesMap,
        formInput: createParagraphFormInput({
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
