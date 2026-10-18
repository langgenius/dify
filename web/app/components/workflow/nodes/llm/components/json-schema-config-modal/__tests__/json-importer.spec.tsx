import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import JsonImporter from '../json-importer'
import { MittProvider, useMittContext, VisualEditorContext } from '../visual-editor/context'
import { createVisualEditorStore } from '../visual-editor/store'

// Monaco editing is outside this test; parsing, depth validation and editor state remain real.
vi.mock('../code-editor', () => ({
  default: ({ value, onUpdate }: { value: string; onUpdate: (value: string) => void }) => (
    <textarea
      aria-label="JSON input"
      value={value}
      onChange={(event) => onUpdate(event.target.value)}
    />
  ),
}))

function setup() {
  const store = createVisualEditorStore()
  const onSubmit = vi.fn()
  const onQuitEditing = vi.fn()
  function Subscriber() {
    useMittContext().useSubscribe('quitEditing', onQuitEditing)
    return null
  }
  render(
    <VisualEditorContext value={store}>
      <MittProvider>
        <Subscriber />
        <JsonImporter onSubmit={onSubmit} updateBtnWidth={vi.fn()} />
      </MittProvider>
    </VisualEditorContext>,
  )
  return { store, onSubmit, onQuitEditing, user: userEvent.setup() }
}
const importButton = () => screen.getByRole('button', { name: /nodes.llm.jsonSchema.import/ })
const submitButton = () => screen.getByRole('button', { name: /operation.submit/ })

it.each(['advancedEditing', 'isAddingNewField'] as const)(
  'notifies actual editor subscribers when opening after %s changes',
  async (flag) => {
    const { store, user, onQuitEditing } = setup()
    await user.click(importButton())
    expect(onQuitEditing).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /operation.cancel/ }))
    act(() => store.setState({ [flag]: true }))
    await user.click(importButton())
    expect(onQuitEditing).toHaveBeenCalledExactlyOnceWith({})
  },
)

it.each(['[]', '42'])('rejects non-object JSON %s', async (value) => {
  const { user, onSubmit } = setup()
  await user.click(importButton())
  await user.click(screen.getByRole('textbox', { name: 'JSON input' }))
  await user.paste(value)
  await user.click(submitButton())
  expect(
    screen.getByText('Root must be an object, not an array or primitive value.'),
  ).toBeInTheDocument()
  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('rejects objects exceeding the real depth limit and accepts a corrected object', async () => {
  const { user, onSubmit } = setup()
  let nested: Record<string, unknown> = { leaf: 'value' }
  for (let level = 0; level < JSON_SCHEMA_MAX_DEPTH; level++) nested = { nested }
  await user.click(importButton())
  const input = screen.getByRole('textbox', { name: 'JSON input' })
  await user.click(input)
  await user.paste(JSON.stringify(nested))
  await user.click(submitButton())
  expect(
    screen.getByText(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`),
  ).toBeInTheDocument()
  expect(onSubmit).not.toHaveBeenCalled()
  await user.clear(input)
  await user.paste('{"foo":"bar"}')
  await user.click(submitButton())
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ foo: 'bar' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('enforces the schema depth limit for objects inside arrays', async () => {
  const { user, onSubmit } = setup()
  function exampleWithSchemaDepth(depth: number) {
    let item: Record<string, unknown> = { leaf: 'value' }
    // The root object, array and first item object already contribute three levels.
    for (let level = 3; level < depth; level++) item = { nested: item }
    return { rows: [item] }
  }
  await user.click(importButton())
  const input = screen.getByRole('textbox', { name: 'JSON input' })
  await user.click(input)
  await user.paste(JSON.stringify(exampleWithSchemaDepth(JSON_SCHEMA_MAX_DEPTH + 1)))
  await user.click(submitButton())
  expect(
    screen.getByText(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`),
  ).toBeInTheDocument()
  expect(onSubmit).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeInTheDocument()

  const boundaryExample = exampleWithSchemaDepth(JSON_SCHEMA_MAX_DEPTH)
  await user.clear(input)
  await user.paste(JSON.stringify(boundaryExample))
  await user.click(submitButton())
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(boundaryExample)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('preserves empty arrays, primitive arrays and first-item schema inference', async () => {
  const { user, onSubmit } = setup()
  let laterItem: Record<string, unknown> = { leaf: 'value' }
  for (let level = 0; level < JSON_SCHEMA_MAX_DEPTH; level++) laterItem = { nested: laterItem }
  const example = {
    empty: [],
    primitives: [1, 2],
    primitiveFirst: [1, laterItem],
    objectFirst: [{ leaf: 'first' }, laterItem],
  }
  await user.click(importButton())
  await user.click(screen.getByRole('textbox', { name: 'JSON input' }))
  await user.paste(JSON.stringify(example))
  await user.click(submitButton())
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(example)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('reports malformed JSON and allows correction without replacing JSON.parse', async () => {
  const { user, onSubmit } = setup()
  await user.click(importButton())
  const input = screen.getByRole('textbox', { name: 'JSON input' })
  await user.clear(input)
  await user.paste('{bad')
  await user.click(submitButton())
  expect(screen.getByText(/Expected property name|JSON at position/)).toBeInTheDocument()
  expect(onSubmit).not.toHaveBeenCalled()
  await user.clear(input)
  await user.paste('{"count":2}')
  await user.click(submitButton())
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ count: 2 })
})
