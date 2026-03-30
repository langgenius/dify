import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import { fireEvent, render, screen } from '@testing-library/react'
import SchemaModal from '../schema-modal'

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor', () => ({
  default: ({
    rootName,
    readOnly,
  }: {
    rootName: string
    readOnly?: boolean
  }) => (
    <div data-testid="visual-editor">
      <span>{rootName}</span>
      <span>{readOnly ? 'readonly' : 'editable'}</span>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor/context', () => ({
  MittProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  VisualEditorContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const schema = {
  type: 'object',
  properties: {},
} as unknown as SchemaRoot

describe('SchemaModal', () => {
  it('should not render dialog content when hidden', () => {
    render(
      <SchemaModal
        isShow={false}
        schema={schema}
        rootName="Hidden Schema"
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByText('workflow.nodes.agent.parameterSchema')).not.toBeInTheDocument()
    expect(screen.queryByTestId('visual-editor')).not.toBeInTheDocument()
  })

  it('should render schema title and visual editor when shown', () => {
    render(
      <SchemaModal
        isShow
        schema={schema}
        rootName="Tool Schema"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('workflow.nodes.agent.parameterSchema')).toBeInTheDocument()
    expect(screen.getByTestId('visual-editor')).toHaveTextContent('Tool Schema')
    expect(screen.getByTestId('visual-editor')).toHaveTextContent('readonly')
  })

  it('should call onClose when the close button is clicked', () => {
    const onClose = vi.fn()

    render(
      <SchemaModal
        isShow
        schema={schema}
        rootName="Closable Schema"
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
