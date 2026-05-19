import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SchemaModal from '../schema-modal'

vi.mock('@langgenius/dify-ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode, open?: boolean }) =>
    open === false ? null : <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div data-testid="modal">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor', () => ({
  default: ({ rootName }: { rootName: string }) => <div data-testid="visual-editor">{rootName}</div>,
}))

vi.mock('@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor/context', () => ({
  MittProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  VisualEditorContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('SchemaModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render content when hidden', () => {
    render(
      <SchemaModal
        isShow={false}
        schema={{} as never}
        rootName="root"
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('modal')).not.toBeInTheDocument()
  })

  it('renders the schema title and closes when the close control is clicked', () => {
    const onClose = vi.fn()
    render(
      <SchemaModal
        isShow
        schema={{ type: 'object' } as never}
        rootName="response"
        onClose={onClose}
      />,
    )

    expect(screen.getByText('workflow.nodes.agent.parameterSchema')).toBeInTheDocument()
    expect(screen.getByTestId('visual-editor')).toHaveTextContent('response')

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onClose).toHaveBeenCalled()
  })
})
