import type { ComponentProps } from 'react'
import type { WorkflowNodesMap } from '../../workflow-variable-block/node'
import type { FormInputItem, ParagraphFormInput } from '@/app/components/workflow/nodes/human-input/types'
import type { ValueSelector } from '@/app/components/workflow/types'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { cleanup, fireEvent, render } from '@testing-library/react'
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
      const { getAllByTestId } = renderComponent()

      const buttons = getAllByTestId(/action-btn-/)
      expect(buttons).toHaveLength(2)
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
      const { queryAllByTestId } = renderComponent({ readonly: true })

      expect(queryAllByTestId(/action-btn-/)).toHaveLength(0)
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
      const { getByTestId, onRemove } = renderComponent()

      fireEvent.click(getByTestId('action-btn-remove'))

      expect(onRemove).toHaveBeenCalledWith(varName)
      expect(onRemove).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edit flow', () => {
    // it('should call onChange when name is unchanged', async () => {
    //   const { findByRole, findByTestId, onChange, onRename } = renderComponent()

    //   fireEvent.click(await findByTestId('action-btn-edit'))

    //   await findByRole('textbox')

    //   const saveBtn = await findByTestId('hitl-input-save-btn')
    //   fireEvent.click(saveBtn)

    //   expect(onChange).toHaveBeenCalledWith(
    //     expect.objectContaining({
    //       output_variable_name: varName,
    //     }),
    //   )

    //   expect(onRename).not.toHaveBeenCalled()
    // })

    it('should close modal without update when cancel is clicked', async () => {
      const {
        findByRole,
        findByTestId,
        queryByRole,
        onChange,
        onRename,
      } = renderComponent()

      fireEvent.click(await findByTestId('action-btn-edit'))

      await findByRole('textbox')

      fireEvent.click(await findByTestId('hitl-input-cancel-btn'))

      expect(onChange).not.toHaveBeenCalled()
      expect(onRename).not.toHaveBeenCalled()

      expect(queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  describe('Default formInput', () => {
    it('should pass default payload to InputField when formInput is undefined', async () => {
      const { findByTestId, findByRole } = renderComponent({
        formInput: undefined,
      })

      fireEvent.click(await findByTestId('action-btn-edit'))

      const textbox = await findByRole('textbox')

      fireEvent.click(await findByTestId('hitl-input-save-btn'))

      expect(textbox).toHaveValue('customer_name')
    })

    // it('should call onRename when variable name changes', async () => {
    //   const {
    //     findByRole,
    //     findByTestId,
    //     onChange,
    //     onRename,
    //   } = renderComponent()

    //   fireEvent.click(await findByTestId('action-btn-edit'))

    //   const input = (await findByRole('textbox')) as HTMLInputElement

    //   fireEvent.change(input, { target: { value: 'updated_name' } })

    //   fireEvent.click(await screen.findByTestId('hitl-input-save-btn'))

    //   expect(onChange).not.toHaveBeenCalled()

    //   expect(onRename).toHaveBeenCalledWith(
    //     expect.objectContaining({
    //       output_variable_name: 'updated_name',
    //     }),
    //     varName,
    //   )
    // })

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
