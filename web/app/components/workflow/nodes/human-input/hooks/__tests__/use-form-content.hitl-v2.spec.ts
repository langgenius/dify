import type { HumanInputV2NodeType } from '../../../human-input-v2/types'
import type { HumanInputNodeType, ParagraphFormInput } from '../../types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useHumanInputFormContent from '../../shared/use-form-content'

const mockUseWorkflow = vi.hoisted(() => vi.fn())
const mockUseNodeCrud = vi.hoisted(() => vi.fn())

vi.mock('../../../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../hooks/use-workflow')>()

  return {
    ...actual,
    useWorkflow: () => mockUseWorkflow(),
  }
})

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseNodeCrud(...args),
}))

const createFormInput = (overrides: Partial<ParagraphFormInput> = {}): ParagraphFormInput => ({
  type: InputVarType.paragraph,
  output_variable_name: 'old_name',
  default: {
    selector: [],
    type: 'constant',
    value: '',
  },
  ...overrides,
})

const createPayload = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Human Input',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [],
  form_content: 'Hello {{#$output.old_name#}}',
  inputs: [createFormInput()],
  user_actions: [],
  timeout: 1,
  timeout_unit: 'day',
  ...overrides,
})

describe('human-input/use-form-content', () => {
  const mockSetInputs = vi.fn()
  const mockHandleOutVarRenameChange = vi.fn()
  let currentInputs = createPayload()

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()
    mockUseWorkflow.mockReturnValue({
      handleOutVarRenameChange: mockHandleOutVarRenameChange,
    })
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    }))
  })

  it.each(['field', 'content'] as const)(
    'should preserve the latest V2 configuration when an existing editor saves %s changes',
    (change) => {
      const initialPayload: HumanInputV2NodeType = {
        title: 'Human Input V2',
        desc: '',
        type: BlockEnum.HumanInput,
        version: '2',
        form_content: 'Hello {{#$output.old_name#}}',
        inputs: [createFormInput()],
        user_actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
        timeout: 1,
        timeout_unit: 'hour',
        recipients_spec: [{ type: 'initiator' }],
        message_template: { subject: 'Approval', body: 'Please review' },
        debug_mode: { enabled: false, channels: [] },
      }
      mockUseNodeCrud.mockImplementation((_id: string, payload: HumanInputV2NodeType) => ({
        inputs: payload,
        setInputs: mockSetInputs,
      }))
      const { result, rerender } = renderHook(
        ({ payload }) => useHumanInputFormContent('human-input-node', payload),
        { initialProps: { payload: initialPayload } },
      )
      // Existing Lexical blocks retain these callbacks while the node panel changes.
      const editorCallbacks = result.current
      const latestPayload: HumanInputV2NodeType = {
        ...initialPayload,
        recipients_spec: [{ type: 'initiator' }, { type: 'contact', contact_id: 'contact-1' }],
        user_actions: [{ id: 'approve', title: 'Approve updated', button_style: 'primary' }],
        timeout: 2,
        form_content: 'Updated body {{#$output.old_name#}}',
        message_template: { subject: 'Updated approval', body: 'Updated message' },
      }
      rerender({ payload: latestPayload })
      const nextInputs = [
        createFormInput({
          default: { selector: [], type: 'constant', value: 'Updated default' },
        }),
      ]

      act(() => {
        if (change === 'field') editorCallbacks.handleFormInputsChange(nextInputs)
        else editorCallbacks.handleFormContentChange('Edited body {{#$output.old_name#}}')
      })

      expect(mockSetInputs).toHaveBeenCalledWith({
        ...latestPayload,
        ...(change === 'field'
          ? { inputs: nextInputs }
          : { form_content: 'Edited body {{#$output.old_name#}}' }),
      })
    },
  )
})
