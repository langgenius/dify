import type { WorkflowToolModalPayload } from '../index'
import { act, renderHook } from '@testing-library/react'
import { useWorkflowToolForm } from '../use-workflow-tool-form'

const mockToastError = vi.fn()

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const createPayload = (): WorkflowToolModalPayload => ({
  icon: {
    content: '🔧',
    background: '#ffffff',
  },
  label: 'Test Tool',
  name: 'test_tool',
  description: 'Test description',
  parameters: [
    {
      name: 'param1',
      description: 'Parameter 1',
      form: 'llm',
      required: true,
      type: 'string',
    },
  ],
  outputParameters: [
    {
      name: 'result',
      description: 'Result output',
      type: 'string',
    },
  ],
  labels: ['label1'],
  privacy_policy: 'https://example.com/privacy',
  workflow_app_id: 'workflow-app-123',
  workflow_tool_id: 'workflow-tool-456',
})

describe('useWorkflowToolForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should submit create payload immediately in add mode', () => {
    const onCreate = vi.fn()
    const { result } = renderHook(() => useWorkflowToolForm({
      isAdd: true,
      onCreate,
      payload: createPayload(),
    }))

    act(() => {
      result.current.handlePrimaryAction()
    })

    expect(onCreate).toHaveBeenCalledWith({
      description: 'Test description',
      icon: {
        content: '🔧',
        background: '#ffffff',
      },
      label: 'Test Tool',
      labels: ['label1'],
      name: 'test_tool',
      parameters: [
        {
          name: 'param1',
          description: 'Parameter 1',
          form: 'llm',
        },
      ],
      privacy_policy: 'https://example.com/privacy',
      workflow_app_id: 'workflow-app-123',
    })
  })

  it('should open the confirmation modal in edit mode before saving', () => {
    const { result } = renderHook(() => useWorkflowToolForm({
      onSave: vi.fn(),
      payload: createPayload(),
    }))

    act(() => {
      result.current.handlePrimaryAction()
    })

    expect(result.current.showConfirmModal).toBe(true)
  })

  it('should report validation errors when the tool-call name is invalid', () => {
    const onCreate = vi.fn()
    const { result } = renderHook(() => useWorkflowToolForm({
      isAdd: true,
      onCreate,
      payload: createPayload(),
    }))

    act(() => {
      result.current.setName('bad-name')
    })
    act(() => {
      result.current.handleConfirm()
    })

    expect(onCreate).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('tools.createTool.nameForToolCalltools.createTool.nameForToolCallTip')
  })
})
