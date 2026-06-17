import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $getNodeByKey } from 'lexical'
import AgentOutputBlockComponent from '../component'
import { $createAgentOutputBlockNode } from '../node'

const { mockEditorUpdate, mockGetRootText, mockNodeReplace } = vi.hoisted(() => ({
  mockEditorUpdate: vi.fn((callback: () => void) => callback()),
  mockGetRootText: {
    value: '[§output:summary:summary§]',
  },
  mockNodeReplace: vi.fn(),
}))

vi.mock('@lexical/react/LexicalComposerContext')
vi.mock('lexical', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lexical')>()

  return {
    ...actual,
    $getNodeByKey: vi.fn(),
    $getRoot: vi.fn(() => ({
      getChildren: () => [{
        getTextContent: () => mockGetRootText.value,
      }],
    })),
  }
})

vi.mock('../node', () => ({
  $createAgentOutputBlockNode: vi.fn((name: string, outputType: string) => ({
    name,
    outputType,
  })),
  $isAgentOutputBlockNode: () => true,
}))

const outputs: DeclaredOutputConfig[] = [
  {
    name: 'output',
    type: 'string',
    required: false,
  },
]

describe('AgentOutputBlockComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useLexicalComposerContext).mockReturnValue([
      {
        update: mockEditorUpdate,
      },
      {},
    ] as unknown as ReturnType<typeof useLexicalComposerContext>)
    vi.mocked($getNodeByKey).mockReturnValue({
      replace: mockNodeReplace,
    } as never)
  })

  it('does not replace the Lexical node while typing an output name', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="output"
        outputType="string"
        outputs={outputs}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' })

    await user.clear(input)
    await user.type(input, 'summary')

    expect(input).toHaveValue('summary')
    expect(mockNodeReplace).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()

    await user.tab()

    expect($createAgentOutputBlockNode).toHaveBeenCalledWith(
      'summary',
      'string',
      expect.arrayContaining([
        expect.objectContaining({
          name: 'summary',
          type: 'string',
          required: false,
        }),
      ]),
      onChange,
    )
    expect(mockNodeReplace).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        name: 'summary',
        type: 'string',
        required: false,
      }),
    ]), '[§output:summary:summary§]')
  })
})
