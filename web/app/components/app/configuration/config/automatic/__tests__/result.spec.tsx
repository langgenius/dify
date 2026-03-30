import type { GenRes } from '@/service/debug'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { BlockEnum } from '@/app/components/workflow/types'
import Result from '../result'
import { GeneratorType } from '../types'

const mockCopy = vi.fn()
const mockPromptEditor = vi.fn()
const mockCodeEditor = vi.fn()
const mockUseAvailableVarList = vi.fn()

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    value: string
    workflowVariableBlock: Record<string, unknown>
  }) => {
    mockPromptEditor(props)
    return <div data-testid="prompt-editor">{props.value}</div>
  },
}))

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/code-editor', () => ({
  default: (props: { value?: string }) => {
    mockCodeEditor(props)
    return <div data-testid="code-editor">{props.value}</div>
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

const createCurrent = (overrides: Partial<GenRes> = {}): GenRes => ({
  message: 'Optimization note',
  modified: 'Generated result',
  ...overrides,
})

describe('Result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(toast, 'success').mockImplementation(vi.fn())
    mockUseAvailableVarList.mockReturnValue({
      availableNodes: [{
        data: {
          title: 'Start Node',
          type: BlockEnum.Start,
        },
        height: 100,
        id: 'start-node',
        position: { x: 10, y: 20 },
        width: 120,
      }],
      availableVars: [{ value_selector: ['sys', 'query'] }],
    })
  })

  it('should render prompt results in basic mode and support copy/apply actions', () => {
    const onApply = vi.fn()
    render(
      <Result
        current={createCurrent()}
        currentVersionIndex={0}
        generatorType={GeneratorType.prompt}
        isBasicMode
        onApply={onApply}
        setCurrentVersionIndex={vi.fn()}
        versions={[createCurrent()]}
      />,
    )

    fireEvent.click(screen.getAllByRole('button')[0])
    fireEvent.click(screen.getByRole('button', { name: 'appDebug.generate.apply' }))

    expect(mockCopy).toHaveBeenCalledWith('Generated result')
    expect(toast.success).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      value: 'Generated result',
      workflowVariableBlock: {
        show: false,
      },
    }))
    expect(screen.getByText('appDebug.generate.optimizationNote')).toBeInTheDocument()
    expect(screen.getByTestId('markdown-body')).toBeInTheDocument()
  })

  it('should render workflow prompt results with workflow variable metadata', () => {
    render(
      <Result
        current={createCurrent({ message: undefined, modified: 'v2' })}
        currentVersionIndex={1}
        generatorType={GeneratorType.prompt}
        nodeId="node-1"
        onApply={vi.fn()}
        setCurrentVersionIndex={vi.fn()}
        versions={[createCurrent({ modified: 'v1' }), createCurrent({ message: undefined, modified: 'v2' })]}
      />,
    )

    const promptEditorProps = mockPromptEditor.mock.lastCall?.[0]
    expect(promptEditorProps).toEqual(expect.objectContaining({
      value: 'v2',
      workflowVariableBlock: expect.objectContaining({
        show: true,
        variables: [{ value_selector: ['sys', 'query'] }],
        workflowNodesMap: expect.objectContaining({
          'start-node': expect.objectContaining({
            title: 'Start Node',
            type: BlockEnum.Start,
          }),
          'sys': expect.objectContaining({
            title: 'workflow.blocks.start',
            type: BlockEnum.Start,
          }),
        }),
      }),
    }))
  })

  it('should render code results through the code editor branch', () => {
    render(
      <Result
        current={createCurrent({ modified: '{"name":"demo"}' })}
        currentVersionIndex={0}
        generatorType={GeneratorType.code}
        onApply={vi.fn()}
        setCurrentVersionIndex={vi.fn()}
        versions={[createCurrent({ modified: '{"name":"demo"}' })]}
      />,
    )

    expect(screen.getByTestId('code-editor')).toHaveTextContent('{"name":"demo"}')
    expect(mockCodeEditor).toHaveBeenCalledWith(expect.objectContaining({
      value: '{"name":"demo"}',
    }))
  })
})
