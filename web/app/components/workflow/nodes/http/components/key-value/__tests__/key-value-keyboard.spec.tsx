import { act, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import useKeyValueList from '../../../hooks/use-key-value-list'
import KeyValueEdit from '../key-value-edit'

// The real key/value field is a shared Lexical editor. We stub it with a
// textarea that models the one behaviour under test: pressing Enter inserts a
// newline into the field content unless something upstream suppresses the key
// event. This lets the Enter-corruption fix be exercised as a true
// fail-before / pass-after without depending on Lexical + contenteditable in
// happy-dom.
vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    onFocusChange,
    className,
  }: {
    value: string
    onChange: (value: string) => void
    onFocusChange?: (value: boolean) => void
    className?: string
  }) => (
    <textarea
      aria-label="field"
      className={className}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      onKeyDown={(e) => {
        // Models Lexical plain-text Enter: insert a newline into the field.
        if (e.key === 'Enter') {
          e.preventDefault()
          onChange(`${value}\n`)
        }
      }}
    />
  ),
}))

const Harness: React.FC<{ initial?: string }> = ({ initial = '' }) => {
  const onChange = React.useCallback(() => {}, [])
  const { list, setList, addItem } = useKeyValueList(initial, onChange)
  return (
    <KeyValueEdit readonly={false} nodeId="node-1" list={list} onChange={setList} onAdd={addItem} />
  )
}

const getRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-kv-row]'))

const getField = (row: HTMLElement, role: 'key' | 'value') =>
  row.querySelector<HTMLTextAreaElement>(`[data-kv-field="${role}"] textarea`)!

describe('http key-value editor keyboard behaviour', () => {
  it('(a) Enter in the key field does not insert a newline / corrupt the key', () => {
    const { container } = render(<Harness initial="foo:bar" />)
    const rowsBefore = getRows(container)
    expect(rowsBefore).toHaveLength(1)
    const keyField = getField(rowsBefore[0]!, 'key')
    expect(keyField.value).toBe('foo')

    const notPrevented = fireEvent.keyDown(keyField, { key: 'Enter' })

    // The Enter was intercepted (default prevented) before reaching the editor,
    // so the key is untouched and no phantom row splits off.
    expect(notPrevented).toBe(false)
    expect(getField(getRows(container)[0]!, 'key').value).toBe('foo')
    expect(getRows(container)).toHaveLength(1)
  })

  it('(b) Enter in the last row value field creates a trailing row and moves focus to its key', () => {
    const { container } = render(<Harness initial="foo:bar" />)
    expect(getRows(container)).toHaveLength(1)
    const valueField = getField(getRows(container)[0]!, 'value')

    fireEvent.keyDown(valueField, { key: 'Enter' })

    const rows = getRows(container)
    expect(rows).toHaveLength(2)
    const newKeyField = getField(rows[1]!, 'key')
    expect(newKeyField.value).toBe('')
    expect(document.activeElement).toBe(newKeyField)
    // The value was not corrupted with a newline.
    expect(getField(rows[0]!, 'value').value).toBe('bar')
  })

  it('(c) Tab in the last row value field creates a trailing row and moves focus to its key', () => {
    const { container } = render(<Harness initial="foo:bar" />)
    const valueField = getField(getRows(container)[0]!, 'value')

    fireEvent.keyDown(valueField, { key: 'Tab' })

    const rows = getRows(container)
    expect(rows).toHaveLength(2)
    expect(document.activeElement).toBe(getField(rows[1]!, 'key'))
  })

  it('does not hijack Enter while the variable typeahead menu is open', () => {
    const menu = document.createElement('div')
    menu.id = 'typeahead-menu'
    document.body.appendChild(menu)
    try {
      const { container } = render(<Harness initial="foo:bar" />)
      const keyField = getField(getRows(container)[0]!, 'key')

      // With the menu open, Enter must fall through to the editor (which selects
      // a variable). Our stub models the fall-through as a newline insertion.
      fireEvent.keyDown(keyField, { key: 'Enter' })

      expect(getField(getRows(container)[0]!, 'key').value).toContain('\n')
    } finally {
      document.body.removeChild(menu)
    }
  })

  it('(cleanup) empty rows are dropped when the list is serialized', () => {
    const emitted: string[] = []
    const { result } = renderKeyValueHook((v) => emitted.push(v))

    act(() => {
      result.current.setList([
        { id: 'a', key: 'k1', value: 'v1' },
        { id: 'b', key: '', value: '' },
        { id: 'c', key: 'k2', value: '' },
        { id: 'd', key: 'k3', value: 'v3' },
      ])
    })

    // Only fully-populated rows survive the string round-trip; blank / partial
    // rows are filtered out by stringifyList.
    expect(emitted.at(-1)).toBe('k1:v1\nk3:v3')
  })
})

// Small helper to drive the hook directly for the serialize-cleanup assertion.
function renderKeyValueHook(onChange: (value: string) => void) {
  const result: { current: ReturnType<typeof useKeyValueList> } = { current: null as never }
  const HookProbe: React.FC = () => {
    result.current = useKeyValueList('', onChange)
    return null
  }
  render(<HookProbe />)
  return { result }
}
