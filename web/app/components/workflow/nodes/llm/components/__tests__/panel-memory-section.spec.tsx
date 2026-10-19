import type { LLMNodeType } from '../../types'
import type { Memory, Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import PanelMemorySection from '../panel-memory-section'

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  default: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string
    onChange: (value: string) => void
    readOnly?: boolean
  }) => (
    <textarea
      aria-label="Memory prompt"
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const createInputs = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  title: 'LLM',
  desc: '',
  type: 'llm' as LLMNodeType['type'],
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat' as const,
    completion_params: {},
  } as LLMNodeType['model'],
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

const baseProps = {
  readOnly: false,
  isChatflow: true,
  isChatModel: true,
  isCompletionModel: false,
  inputs: createInputs(),
  hasSetBlockStatus: {
    history: false,
    query: true,
    context: false,
  },
  availableVars: [] as NodeOutPutVar[],
  availableNodesWithParent: [] as Node[],
  handleSyeQueryChange: vi.fn(),
  handleMemoryChange: vi.fn(),
}

it.each([
  { resourceKind: 'app' as const, expected: '{{#sys.query#}}\n\n{{#sys.files#}}' },
  { resourceKind: 'snippet' as const, expected: '' },
])(
  'enables memory with the correct $resourceKind prompt and saves edits',
  async ({ resourceKind, expected }) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Harness() {
      const [memory, setMemory] = useState<Memory>()
      return (
        <PanelMemorySection
          {...baseProps}
          resourceKind={resourceKind}
          inputs={createInputs({ memory })}
          handleMemoryChange={(next) => {
            setMemory(next)
            onChange(next)
          }}
          handleSyeQueryChange={(query) =>
            setMemory((previous) => ({ ...previous!, query_prompt_template: query }))
          }
        />
      )
    }
    render(<Harness />)
    await user.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      window: { enabled: false, size: 50 },
      query_prompt_template: expected,
    })
    expect(screen.getByRole('textbox', { name: 'Memory prompt' })).toHaveValue(expected)
    const prompt = screen.getByRole('textbox', { name: 'Memory prompt' })
    await user.clear(prompt)
    expect(prompt).toHaveValue('')
    await user.type(prompt, 'Custom prompt')
    expect(screen.getByRole('textbox', { name: 'Memory prompt' })).toHaveValue('Custom prompt')
    if (resourceKind === 'app')
      expect(screen.getByText('workflow.nodes.llm.sysQueryInUser')).toBeVisible()
    else expect(screen.queryByText('workflow.nodes.llm.sysQueryInUser')).not.toBeInTheDocument()
  },
)

it('prevents memory activation when read-only', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <PanelMemorySection
      {...baseProps}
      readOnly
      inputs={createInputs({ memory: undefined })}
      handleMemoryChange={onChange}
    />,
  )
  await user.click(screen.getByRole('switch'))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox', { name: 'Memory prompt' })).not.toBeInTheDocument()
})

it('hides memory settings outside chatflow', () => {
  render(
    <PanelMemorySection {...baseProps} isChatflow={false} isChatModel={false} isCompletionModel />,
  )
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
