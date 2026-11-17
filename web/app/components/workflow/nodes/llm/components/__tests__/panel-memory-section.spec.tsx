import type { LLMNodeType } from '../../types'
import type { Memory, Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { createNode, createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import PanelMemorySection from '../panel-memory-section'

const createInputs = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  title: 'LLM',
  desc: '',
  type: BlockEnum.LLM,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  },
  prompt_template: [],
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  memory: {
    window: {
      enabled: false,
      size: 10,
    },
    query_prompt_template: '',
  },
  ...overrides,
})

type HarnessProps = {
  availableNodesWithParent: Node[]
  availableVars: NodeOutPutVar[]
  initialMemory?: Memory
  isChatflow?: boolean
  readOnly?: boolean
  resourceKind?: 'app' | 'snippet'
}

function MemoryHarness({
  availableNodesWithParent,
  availableVars,
  initialMemory,
  isChatflow = true,
  readOnly = false,
  resourceKind = 'app',
}: HarnessProps) {
  const [inputs, setInputs] = useState(() => createInputs({ memory: initialMemory }))
  return (
    <>
      <PanelMemorySection
        readOnly={readOnly}
        isChatflow={isChatflow}
        isChatModel
        isCompletionModel={false}
        inputs={inputs}
        hasSetBlockStatus={{ history: false, query: true, context: false }}
        availableVars={availableVars}
        availableNodesWithParent={availableNodesWithParent}
        resourceKind={resourceKind}
        handleMemoryChange={(memory) => setInputs((current) => ({ ...current, memory }))}
        handleSyeQueryChange={(query) =>
          setInputs((current) => ({
            ...current,
            memory: { ...current.memory!, query_prompt_template: query },
          }))
        }
      />
      <output aria-label="Saved memory">
        {inputs.memory ? JSON.stringify(inputs.memory) : 'unset'}
      </output>
    </>
  )
}

const renderMemory = (props: Omit<HarnessProps, 'availableNodesWithParent' | 'availableVars'>) => {
  const start = createStartNode({ id: 'start' })
  const llm = createNode({ id: 'llm', data: createInputs({ memory: props.initialMemory }) })
  return renderWorkflowEditor(
    <MemoryHarness {...props} availableNodesWithParent={[start]} availableVars={[]} />,
    {
      nodes: [start, llm],
      resource:
        props.resourceKind === 'snippet'
          ? { kind: 'snippet', snippetId: 'snippet-1' }
          : { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
    },
  )
}

const savedMemory = () => screen.getByRole('status', { name: 'Saved memory' })

it.each([
  { resourceKind: 'app' as const, expected: '{{#sys.query#}}\n\n{{#sys.files#}}' },
  { resourceKind: 'snippet' as const, expected: '' },
])(
  'enables memory with the correct $resourceKind prompt and saves real editor edits',
  async ({ resourceKind, expected }) => {
    const user = userEvent.setup()
    renderMemory({ resourceKind })
    await user.click(screen.getByRole('switch'))
    expect(savedMemory()).toHaveTextContent(
      JSON.stringify({
        window: { enabled: false, size: 50 },
        query_prompt_template: expected,
      }),
    )

    // This composition does not connect the visible "user" heading to the editor. The Lexical
    // contenteditable is the sole editable textbox; MemoryConfig also exposes a disabled textbox.
    const editableTextboxes = screen
      .getAllByRole('textbox')
      .filter((element) => element.getAttribute('contenteditable') === 'true')
    expect(editableTextboxes).toHaveLength(1)
    const prompt = editableTextboxes[0]!
    await replacePromptEditorText(prompt, '')
    await waitFor(() =>
      expect(savedMemory()).toHaveTextContent(
        JSON.stringify({
          window: { enabled: false, size: 50 },
          query_prompt_template: '',
        }),
      ),
    )
    await replacePromptEditorText(prompt, 'Custom prompt')
    await waitFor(() =>
      expect(savedMemory()).toHaveTextContent(
        JSON.stringify({
          window: { enabled: false, size: 50 },
          query_prompt_template: 'Custom prompt',
        }),
      ),
    )
    expect(prompt).toHaveTextContent('Custom prompt')
    if (resourceKind === 'app')
      expect(screen.getByText('workflow.nodes.llm.sysQueryInUser')).toBeVisible()
    else expect(screen.queryByText('workflow.nodes.llm.sysQueryInUser')).not.toBeInTheDocument()
  },
)

it('prevents memory activation when read-only', async () => {
  const user = userEvent.setup()
  renderMemory({ readOnly: true })
  const memorySwitch = screen.getByRole('switch')
  expect(memorySwitch).toHaveAttribute('aria-disabled', 'true')
  await user.click(memorySwitch)
  expect(savedMemory()).toHaveTextContent('unset')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('hides memory settings outside chatflow', () => {
  const memory: Memory = {
    window: { enabled: false, size: 10 },
    query_prompt_template: 'Existing prompt',
  }
  renderMemory({ initialMemory: memory, isChatflow: false })
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(savedMemory()).toHaveTextContent(JSON.stringify(memory))
})
