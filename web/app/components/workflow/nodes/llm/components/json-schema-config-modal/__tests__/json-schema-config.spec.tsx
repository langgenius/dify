import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JsonSchemaConfig } from '../json-schema-config'

const emit = vi.fn()
const visualEditorState = {
  advancedEditing: false,
  isAddingNewField: false,
  setAdvancedEditing: vi.fn(),
  setHoveringProperty: vi.fn(),
  setIsAddingNewField: vi.fn(),
}

vi.mock('../visual-editor/context', () => ({
  MittProvider: ({ children }: { children: ReactNode }) => children,
  VisualEditorContextProvider: ({ children }: { children: ReactNode }) => children,
  useMittContext: () => ({ emit }),
}))

vi.mock('../visual-editor/store', () => ({
  useVisualEditorStore: (selector: (state: typeof visualEditorState) => unknown) =>
    selector(visualEditorState),
}))

vi.mock('../visual-editor', () => ({
  default: () => <div>Visual editor panel</div>,
}))

vi.mock('../schema-editor', () => ({
  default: ({ schema, onUpdate }: { schema: string; onUpdate: (schema: string) => void }) => (
    <textarea
      aria-label="JSON schema editor"
      value={schema}
      onChange={(event) => onUpdate(event.target.value)}
    />
  ),
}))

vi.mock('../error-message', () => ({
  default: ({ message }: { message: string }) => <div role="alert">{message}</div>,
}))

vi.mock('../json-schema-generator', () => ({
  default: () => null,
}))

vi.mock('../json-importer', () => ({
  default: () => null,
}))

describe('JsonSchemaConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves tab focus without activating a different editor', async () => {
    const user = userEvent.setup()
    render(<JsonSchemaConfig onSave={vi.fn()} onClose={vi.fn()} />)

    const visualTab = screen.getByRole('tab', { name: 'Visual Editor' })
    const jsonTab = screen.getByRole('tab', { name: 'JSON Schema' })

    visualTab.focus()
    await user.keyboard('{ArrowRight}')

    expect(jsonTab).toHaveFocus()
    expect(visualTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Visual editor panel')).toBeInTheDocument()
  })

  it('keeps the JSON editor active when its value cannot be validated', async () => {
    const user = userEvent.setup()
    render(<JsonSchemaConfig onSave={vi.fn()} onClose={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'JSON Schema' }))

    const editor = screen.getByRole('textbox', { name: 'JSON schema editor' })
    await user.clear(editor)
    await user.type(editor, 'invalid json')
    await user.click(screen.getByRole('tab', { name: 'Visual Editor' }))

    expect(screen.getByRole('tab', { name: 'JSON Schema' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(editor).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
