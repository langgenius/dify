import type { InputVar } from '@/app/components/workflow/types'
import type { SnippetDetail, SnippetInputField } from '@/models/snippet'
import { render } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetSidebar from '../snippet-sidebar'

let capturedVarListProps: {
  list: InputVar[]
  onChange: (list: InputVar[]) => void
} | undefined

vi.mock('@/app/components/app-sidebar/snippet-info/dropdown', () => ({
  default: () => <div data-testid="snippet-info-dropdown" />,
}))

vi.mock('@/app/components/app/configuration/config-var/config-modal', () => ({
  default: () => <div data-testid="config-var-modal" />,
}))

vi.mock('@/next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('@/app/components/workflow/nodes/start/components/var-list', () => ({
  default: (props: {
    list: InputVar[]
    onChange: (list: InputVar[]) => void
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
}

const fields: SnippetInputField[] = [
  {
    type: PipelineInputVarType.textInput,
    label: 'Query',
    variable: 'query',
    required: true,
  },
]

describe('SnippetSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedVarListProps = undefined
  })

  it('should ignore unchanged VarList updates', () => {
    const onFieldsChange = vi.fn()
    render(
      <SnippetSidebar
        snippet={snippet}
        fields={fields}
        readonly={false}
        onFieldsChange={onFieldsChange}
      />,
    )

    capturedVarListProps?.onChange(capturedVarListProps.list)

    expect(onFieldsChange).not.toHaveBeenCalled()
  })

  it('should forward changed VarList updates', () => {
    const onFieldsChange = vi.fn()
    render(
      <SnippetSidebar
        snippet={snippet}
        fields={fields}
        readonly={false}
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
})
