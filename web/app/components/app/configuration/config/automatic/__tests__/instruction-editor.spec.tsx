import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPT_EDITOR_INSERT_QUICKLY } from '@/app/components/base/prompt-editor/plugins/update-block'
import { BlockEnum } from '@/app/components/workflow/types'
import InstructionEditor from '../instruction-editor'
import { GeneratorType } from '../types'

const mockPromptEditor = vi.fn()
const mockEmit = vi.fn()

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: Record<string, unknown>) => {
    mockPromptEditor(props)
    return <div data-testid="prompt-editor">{String(props.value ?? '')}</div>
  },
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

const availableVars: NodeOutPutVar[] = [{ value_selector: ['sys', 'query'] }] as unknown as NodeOutPutVar[]
const availableNodes: Node[] = [{
  data: {
    title: 'Start Node',
    type: BlockEnum.Start,
  },
  height: 100,
  id: 'start-node',
  position: { x: 10, y: 20 },
  width: 120,
}] as unknown as Node[]

describe('InstructionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render prompt placeholder blocks and insert-context trigger', () => {
    render(
      <InstructionEditor
        availableNodes={availableNodes}
        availableVars={availableVars}
        editorKey="editor-1"
        generatorType={GeneratorType.prompt}
        isShowCurrentBlock={false}
        isShowLastRunBlock={false}
        onChange={vi.fn()}
        value="Prompt value"
      />,
    )

    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      currentBlock: {
        generatorType: GeneratorType.prompt,
        show: false,
      },
      errorMessageBlock: {
        show: false,
      },
      lastRunBlock: {
        show: false,
      },
      value: 'Prompt value',
      workflowVariableBlock: expect.objectContaining({
        show: true,
        variables: availableVars,
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

    fireEvent.click(screen.getByText('appDebug.generate.insertContext'))
    expect(mockEmit).toHaveBeenCalledWith({
      instanceId: 'editor-1',
      type: PROMPT_EDITOR_INSERT_QUICKLY,
    })
  })

  it('should enable code-specific blocks for code generators', () => {
    render(
      <InstructionEditor
        availableNodes={availableNodes}
        availableVars={availableVars}
        editorKey="editor-2"
        generatorType={GeneratorType.code}
        isShowCurrentBlock
        isShowLastRunBlock
        onChange={vi.fn()}
        value="Code value"
      />,
    )

    expect(mockPromptEditor).toHaveBeenCalledWith(expect.objectContaining({
      currentBlock: {
        generatorType: GeneratorType.code,
        show: true,
      },
      errorMessageBlock: {
        show: true,
      },
      lastRunBlock: {
        show: true,
      },
    }))
  })
})
