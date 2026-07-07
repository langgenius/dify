import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $getNodeByKey } from 'lexical'
import AgentOutputBlockComponent from '../component'
import { $createAgentOutputBlockNode } from '../node'

const { mockEditorFocus, mockEditorUpdate, mockGetRootText, mockNodeReplace, mockSelectNext } = vi.hoisted(() => ({
  mockEditorFocus: vi.fn(),
  mockEditorUpdate: vi.fn((callback: () => void) => callback()),
  mockGetRootText: {
    value: '[§output:summary:summary§]',
  },
  mockNodeReplace: vi.fn(),
  mockSelectNext: vi.fn(),
}))

vi.mock('@lexical/react/LexicalComposerContext')
vi.mock('@langgenius/dify-ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: ReactNode
    onValueChange: (value: string) => void
  }) => (
    <div>
      {children}
      <button type="button" onClick={() => onValueChange('file')}>Select file</button>
    </div>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItemIndicator: () => <span />,
  SelectItemText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SelectLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  SelectTrigger: ({
    children,
    onClick,
    onMouseDown,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} onMouseDown={onMouseDown} {...props}>
      {children}
    </button>
  ),
}))
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
  $createAgentOutputBlockNode: vi.fn((name: string, outputType: string, isEditing: boolean) => ({
    isEditing,
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
    mockGetRootText.value = '[§output:summary:summary§]'
    vi.mocked(useLexicalComposerContext).mockReturnValue([
      {
        focus: mockEditorFocus,
        update: mockEditorUpdate,
      },
      {},
    ] as unknown as ReturnType<typeof useLexicalComposerContext>)
    vi.mocked($getNodeByKey).mockReturnValue({
      replace: mockNodeReplace.mockReturnValue({
        selectNext: mockSelectNext,
      }),
    } as never)
  })

  it('does not replace the Lexical node while typing an output name and commits on blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="output"
        outputType="string"
        isEditing
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
      false,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'summary',
          type: 'string',
          required: false,
        }),
      ]),
      onChange,
      undefined,
    )
    expect(mockNodeReplace).toHaveBeenCalledTimes(1)
    expect(mockSelectNext).not.toHaveBeenCalled()
    expect(mockEditorFocus).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        name: 'summary',
        type: 'string',
        required: false,
      }),
    ]), '[§output:summary:summary§]')
  })

  it('moves the editor selection after the output block when committing with Enter', async () => {
    const user = userEvent.setup()

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="output"
        outputType="string"
        isEditing
        outputs={outputs}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' })

    await user.clear(input)
    await user.type(input, 'summary')
    await user.keyboard('{Enter}')

    expect(mockNodeReplace).toHaveBeenCalledTimes(1)
    expect(mockSelectNext).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(mockEditorFocus).toHaveBeenCalledTimes(1)
    })
  })

  it('commits the input DOM value on Enter even before React state rerenders', () => {
    const onChange = vi.fn()

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="output"
        outputType="string"
        isEditing
        outputs={outputs}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' })

    fireEvent.change(input, { target: { value: 'summary' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect($createAgentOutputBlockNode).toHaveBeenCalledWith(
      'summary',
      'string',
      false,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'summary',
        }),
      ]),
      onChange,
      undefined,
    )
  })

  it('automatically commits file-name outputs as file type', () => {
    const onChange = vi.fn()
    mockGetRootText.value = '[§output:qna_report.pdf:qna_report.pdf§]'

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="output"
        outputType="string"
        isEditing
        outputs={outputs}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' })

    fireEvent.change(input, { target: { value: 'qna_report.pdf' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect($createAgentOutputBlockNode).toHaveBeenCalledWith(
      'qna_report.pdf',
      'file',
      false,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'qna_report.pdf',
          type: 'file',
          file: {
            extensions: [],
            mime_types: [],
          },
        }),
      ]),
      onChange,
      undefined,
    )
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        name: 'qna_report.pdf',
        type: 'file',
      }),
    ]), '[§output:qna_report.pdf:qna_report.pdf§]')
  })

  it('keeps dotted output names as the selected type when the extension is not whitelisted', () => {
    const onChange = vi.fn()
    mockGetRootText.value = '[§output:report.customext:report.customext§]'

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="output"
        outputType="string"
        isEditing
        outputs={outputs}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' })

    fireEvent.change(input, { target: { value: 'report.customext' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect($createAgentOutputBlockNode).toHaveBeenCalledWith(
      'report.customext',
      'string',
      false,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'report.customext',
          type: 'string',
        }),
      ]),
      onChange,
      undefined,
    )
  })

  it('does not commit the name blur before selecting an output type', () => {
    const onChange = vi.fn()
    mockGetRootText.value = '[§output:summary:summary§]'

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="output"
        outputType="string"
        isEditing
        outputs={outputs}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' })
    const typeTrigger = screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.typeLabel' })

    fireEvent.change(input, { target: { value: 'summary' } })
    fireEvent.mouseDown(typeTrigger)
    fireEvent.blur(input)

    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Select file' }))

    expect($createAgentOutputBlockNode).toHaveBeenCalledWith(
      'summary',
      'file',
      false,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'summary',
          type: 'file',
        }),
      ]),
      onChange,
      undefined,
    )
  })

  it('does not save stale output data when the Lexical node has already been replaced', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    vi.mocked($getNodeByKey).mockReturnValue(null)

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="output"
        outputType="string"
        isEditing
        outputs={outputs}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' })

    await user.clear(input)
    await user.type(input, 'summary')
    await user.keyboard('{Enter}')

    expect(mockNodeReplace).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(mockEditorFocus).not.toHaveBeenCalled()
  })

  it('renders the committed output block as non-editable adaptive text', () => {
    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="qna_report_pdf"
        outputType="file"
        isEditing={false}
        outputs={outputs}
      />,
    )

    expect(screen.queryByRole('textbox', { name: 'workflow.nodes.agent.outputVars.nameLabel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workflow.nodes.agent.outputVars.typeLabel' })).not.toBeInTheDocument()
    expect(screen.getByText('qna_report_pdf')).toBeInTheDocument()
    expect(screen.getByText('file')).toBeInTheDocument()
  })

  it('requests the output editor when hovering a committed output block', () => {
    const onEdit = vi.fn()

    render(
      <AgentOutputBlockComponent
        nodeKey="output-node"
        name="qna_report_pdf"
        outputType="file"
        isEditing={false}
        outputs={outputs}
        onEdit={onEdit}
      />,
    )

    fireEvent.mouseEnter(screen.getByText('qna_report_pdf').parentElement!)

    expect(onEdit).toHaveBeenCalledWith('qna_report_pdf', 'file')
  })
})
