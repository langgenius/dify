import type { InputVar } from '@/app/components/workflow/types'
import type { InputVar as SnippetInputField } from '@/models/pipeline'
import type { SnippetDetail } from '@/models/snippet'
import { fireEvent, render, screen } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { PipelineInputVarType } from '@/models/pipeline'
import { SnippetSidebarContent } from '../snippet-sidebar'

let capturedVarListProps:
  | {
      list: InputVar[]
      onChange: (list: InputVar[]) => void
      readonly: boolean
    }
  | undefined
let capturedConfigVarModalProps:
  | {
      onClose: () => void
      onConfirm: (field: InputVar) => void
      varKeys: string[]
    }
  | undefined

vi.mock('@/app/components/app-sidebar/snippet-info/dropdown', () => ({
  default: () => <div data-testid="snippet-info-dropdown" />,
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/app/configuration/config-var/config-modal', () => ({
  default: (props: {
    onClose: () => void
    onConfirm: (field: InputVar) => void
    varKeys: string[]
  }) => {
    capturedConfigVarModalProps = props

    return (
      <div role="dialog" aria-label="config-var-modal">
        <button
          type="button"
          onClick={() =>
            props.onConfirm({
              type: PipelineInputVarType.textInput as unknown as InputVar['type'],
              label: 'Question',
              variable: 'question',
              required: false,
            })
          }
        >
          confirm field
        </button>
        <button type="button" onClick={props.onClose}>
          close modal
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/start/components/var-list', () => ({
  default: (props: {
    list: InputVar[]
    onChange: (list: InputVar[]) => void
    readonly: boolean
  }) => {
    capturedVarListProps = props
    return <div data-testid="var-list" />
  },
}))

const snippet: SnippetDetail = {
  id: 'snippet-1',
  name: 'Snippet',
  description: 'Description',
  updatedAt: '2026-03-29 10:00',
  usage: '0',
  tags: [],
  is_published: true,
}

const fields: SnippetInputField[] = [
  {
    type: PipelineInputVarType.textInput,
    label: 'Query',
    variable: 'query',
    required: true,
  },
]

describe('SnippetSidebarContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedVarListProps = undefined
    capturedConfigVarModalProps = undefined
  })

  it('should ignore unchanged VarList updates', () => {
    const onFieldsChange = vi.fn()
    render(
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly={false}
        evaluationEnabled
        onFieldsChange={onFieldsChange}
      />,
    )

    capturedVarListProps?.onChange(capturedVarListProps.list)

    expect(onFieldsChange).not.toHaveBeenCalled()
  })

  it('should forward changed VarList updates', () => {
    const onFieldsChange = vi.fn()
    render(
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly={false}
        evaluationEnabled
        onFieldsChange={onFieldsChange}
      />,
    )

    capturedVarListProps?.onChange([
      {
        ...capturedVarListProps.list[0]!,
        label: 'Question',
      },
    ])

    expect(onFieldsChange).toHaveBeenCalledWith([
      {
        ...fields[0],
        label: 'Question',
      },
    ])
  })

  it('should hide input field operations when readonly', () => {
    render(
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly
        evaluationEnabled
        onFieldsChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('link', { name: /snippet\.management/i })).not.toBeInTheDocument()
    expect(screen.getByText(snippet.name)).toHaveAttribute('title', snippet.name)
    expect(screen.getByText(snippet.name)).toHaveClass('truncate')
    if (!snippet.description) throw new Error('snippet.description is required for this test')
    expect(screen.getByText(snippet.description)).toHaveAttribute('title', snippet.description)
    expect(screen.getByText(snippet.description)).toHaveClass('truncate')
    expect(
      screen.queryByRole('button', { name: /common\.operation\.add/i }),
    ).not.toBeInTheDocument()
    expect(capturedVarListProps?.readonly).toBe(true)
  })

  it('should render the orchestrate route menu item', () => {
    render(
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly={false}
        evaluationEnabled
        onFieldsChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('link', { name: 'snippet.sectionOrchestrate' })).toHaveAttribute(
      'href',
      '/snippets/snippet-1/orchestrate',
    )
  })

  it('should render evaluation navigation for a published snippet', () => {
    render(
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly={false}
        evaluationEnabled
        onFieldsChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('link', { name: 'evaluation.title' })).toHaveAttribute(
      'href',
      '/snippets/snippet-1/evaluation',
    )
  })

  it('should keep evaluation visible but disabled for an unpublished snippet', () => {
    render(
      <SnippetSidebarContent
        snippet={{ ...snippet, is_published: false }}
        fields={fields}
        readonly={false}
        evaluationEnabled
        onFieldsChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'evaluation.title' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'evaluation.title' })).not.toBeInTheDocument()
  })

  it('should hide the input editor on the evaluation section', () => {
    render(
      <SnippetSidebarContent
        snippet={snippet}
        section="evaluation"
        fields={fields}
        readonly
        evaluationEnabled
      />,
    )

    expect(screen.queryByTestId('var-list')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'evaluation.title' })).toBeInTheDocument()
  })

  it('should add a new input field from the config variable modal', () => {
    const onFieldsChange = vi.fn()
    render(
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly={false}
        evaluationEnabled
        onFieldsChange={onFieldsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.add/i }))
    expect(screen.getByRole('dialog', { name: 'config-var-modal' })).toBeInTheDocument()
    expect(capturedConfigVarModalProps?.varKeys).toEqual(['query'])

    fireEvent.click(screen.getByRole('button', { name: 'confirm field' }))

    expect(onFieldsChange).toHaveBeenCalledWith([
      fields[0],
      {
        type: PipelineInputVarType.textInput,
        label: 'Question',
        variable: 'question',
        required: false,
      },
    ])
    expect(screen.queryByRole('dialog', { name: 'config-var-modal' })).not.toBeInTheDocument()
  })

  it('should reject duplicate variable and label updates', () => {
    const onFieldsChange = vi.fn()
    render(
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly={false}
        evaluationEnabled
        onFieldsChange={onFieldsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.add/i }))
    capturedConfigVarModalProps?.onConfirm({
      type: PipelineInputVarType.textInput as unknown as InputVar['type'],
      label: 'Another label',
      variable: 'query',
      required: true,
    })
    capturedConfigVarModalProps?.onConfirm({
      type: PipelineInputVarType.textInput as unknown as InputVar['type'],
      label: 'Query',
      variable: 'another_query',
      required: true,
    })

    expect(onFieldsChange).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog', { name: 'config-var-modal' })).toBeInTheDocument()
  })

  it('should hide evaluation navigation when Evaluation is unavailable', () => {
    render(
      <SnippetSidebarContent
        snippet={snippet}
        fields={fields}
        readonly
        evaluationEnabled={false}
      />,
    )

    expect(screen.queryByText('evaluation.title')).not.toBeInTheDocument()
  })
})
