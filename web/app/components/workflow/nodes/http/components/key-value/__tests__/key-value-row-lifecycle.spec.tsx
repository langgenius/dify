import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { useState } from 'react'
import useKeyValueList from '../../../hooks/use-key-value-list'
import KeyValue from '../index'

// The HTTP node's key/value editor renders a Lexical `PromptEditor` at its leaf
// (`input-item` -> `input-support-select-var` -> `PromptEditor`). Lexical's real
// contenteditable behaviour is not modelled by happy-dom, and the existing
// PromptEditor tests mock it out for the same reason. The row-lifecycle bug under
// test lives *above* the editor — in `use-key-value-list` + `item.tsx`'s
// onChange/onAdd orchestration — so we mock only the leaf editor with a plain
// controlled input that honours the same `{ value, onChange }` contract.
vi.mock('../key-value-edit/input-item', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
    instanceId,
  }: {
    value: string
    onChange: (v: string) => void
    instanceId?: string
  }) => (
    <input
      data-instanceid={instanceId}
      data-field={instanceId?.startsWith('http-key-') ? 'key' : 'value'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}))

// Mirrors the production wiring in `use-config.ts`:
//   const { list, setList, addItem } = useKeyValueList(inputs.params, handleFieldChange('params'))
//   <KeyValue list={list} onChange={setList} onAdd={addItem} .../>
function ParamsHarness({ initialValue = '' }: { initialValue?: string }) {
  const [paramStr, setParamStr] = useState(initialValue)
  const { list, setList, addItem } = useKeyValueList(paramStr, setParamStr)
  return (
    <>
      <div data-testid="param-string">{paramStr}</div>
      <KeyValue
        nodeId="test-node"
        readonly={false}
        list={list}
        onChange={setList}
        onAdd={addItem}
        isSupportFile={false}
      />
    </>
  )
}

const getKeyInputs = () =>
  screen.getAllByRole('textbox').filter((el) => el.getAttribute('data-field') === 'key')
const getValueInputs = () =>
  screen.getAllByRole('textbox').filter((el) => el.getAttribute('data-field') === 'value')

describe('HTTP key/value table — trailing-row lifecycle (F-HTTP-PARAMS-TABLE)', () => {
  it('keeps the row after typing a key then a single character into the trailing row value', async () => {
    const user = userEvent.setup()
    render(<ParamsHarness />)

    // One empty trailing row is rendered initially.
    expect(getValueInputs()).toHaveLength(1)

    // Type a key into the trailing row.
    await user.type(getKeyInputs()[0]!, 'since')
    expect((getKeyInputs()[0] as HTMLInputElement).value).toBe('since')

    // Capture the trailing row's editor identity BEFORE typing into value.
    const valueIdBefore = getValueInputs()[0]!.getAttribute('data-instanceid')

    // Type a single non-space character into the trailing row's VALUE field.
    await user.type(getValueInputs()[0]!, 'x')

    // The row that had key "since" must still exist and hold value "x".
    await waitFor(() => {
      const keyInputs = getKeyInputs().map((el) => (el as HTMLInputElement).value)
      const valueInputs = getValueInputs().map((el) => (el as HTMLInputElement).value)
      const idx = keyInputs.indexOf('since')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(valueInputs[idx]).toBe('x')
    })

    // And its editor must NOT have been remounted (stable instance id) — a remount
    // is what wipes the in-progress keystroke in the real Lexical editor.
    const sinceIdx = getKeyInputs().findIndex((el) => (el as HTMLInputElement).value === 'since')
    const valueIdAfter = getValueInputs()[sinceIdx]!.getAttribute('data-instanceid')
    expect(valueIdAfter).toBe(valueIdBefore)
  })
})
