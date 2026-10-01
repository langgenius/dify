import type { OutputVar } from '../../../../code/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import OutputVarList from '../output-var-list'

vi.mock('../var-type-picker', () => ({
  default: (props: { value: string; onChange: (v: string) => void; readonly: boolean }) => (
    <select
      data-testid="var-type-picker"
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={props.readonly}
    >
      <option value="string">string</option>
      <option value="number">number</option>
    </select>
  ),
}))

vi.mock('@/app/notifications', () => ({
  toast: { error: vi.fn() },
}))

describe('OutputVarList', () => {
  const createOutputs = (entries: Record<string, string> = {}): OutputVar => {
    const result: OutputVar = {}
    for (const [key, type] of Object.entries(entries))
      result[key] = { type: type as OutputVar[string]['type'], children: null }
    return result
  }

  // Render the component and trigger a rename at the given index.
  // Returns the newOutputs passed to onChange.
  const collectRenameResult = (
    outputs: OutputVar,
    outputKeyOrders: string[],
    renameIndex: number,
    newName: string,
  ): OutputVar => {
    let captured: OutputVar | undefined

    render(
      <OutputVarList
        readonly={false}
        outputs={outputs}
        outputKeyOrders={outputKeyOrders}
        onChange={(newOutputs) => {
          captured = newOutputs
        }}
        onRemove={vi.fn()}
      />,
    )

    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[renameIndex]!, { target: { value: newName } })

    return captured!
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('duplicate name handling', () => {
    it('should preserve outputs entry when renaming one of two duplicate-name variables', () => {
      const outputs = createOutputs({ var_1: 'string' })
      const outputKeyOrders = ['var_1', 'var_1']

      const newOutputs = collectRenameResult(outputs, outputKeyOrders, 1, '')

      // Renamed entry gets a new key ''
      expect(newOutputs['']).toEqual({ type: 'string', children: null })
      // Original key 'var_1' must survive because index 0 still uses it
      expect(newOutputs.var_1).toEqual({ type: 'string', children: null })
    })

    it('should delete old key when renamed entry is the only one using it', () => {
      const outputs = createOutputs({ var_1: 'string', var_2: 'number' })
      const outputKeyOrders = ['var_1', 'var_2']

      const newOutputs = collectRenameResult(outputs, outputKeyOrders, 1, 'renamed')

      expect(newOutputs.renamed).toEqual({ type: 'number', children: null })
      expect(newOutputs.var_2).toBeUndefined()
      expect(newOutputs.var_1).toEqual({ type: 'string', children: null })
    })

    it('should not commit a rename to a name another row already holds', async () => {
      const user = userEvent.setup()
      const outputs = createOutputs({ var_1: 'string', var_12: 'number' })
      const onChange = vi.fn()

      render(
        <OutputVarList
          readonly={false}
          outputs={outputs}
          outputKeyOrders={['var_1', 'var_12']}
          onChange={onChange}
          onRemove={vi.fn()}
        />,
      )

      const inputs = screen.getAllByRole('textbox')
      await user.type(inputs[1]!, '{Backspace}')

      // outputs is keyed by name, so committing would replace var_1's entry with var_12's
      expect(onChange).not.toHaveBeenCalled()
      expect(inputs[1])!.toHaveValue('var_1')
    })
  })

  describe('typing a name another row already holds', () => {
    // The list is controlled, so each change is fed back the way use-output-var-list does:
    // outputs are replaced and the changed row is pointed at its new key.
    const renderControlled = (initialOutputs: OutputVar, initialKeyOrders: string[]) => {
      const state = { outputs: initialOutputs, outputKeyOrders: initialKeyOrders }
      const renames: Array<{ from: string; to: string }> = []

      const Harness = () => {
        const [outputs, setOutputs] = useState(initialOutputs)
        const [outputKeyOrders, setOutputKeyOrders] = useState(initialKeyOrders)

        return (
          <OutputVarList
            readonly={false}
            outputs={outputs}
            outputKeyOrders={outputKeyOrders}
            onChange={(newOutputs, changedIndex, newKey) => {
              state.outputs = newOutputs
              setOutputs(newOutputs)
              if (changedIndex === undefined || newKey === undefined) return

              renames.push({ from: outputKeyOrders[changedIndex]!, to: newKey })
              const newOutputKeyOrders = outputKeyOrders.map((key, index) =>
                index === changedIndex ? newKey : key,
              )
              state.outputKeyOrders = newOutputKeyOrders
              setOutputKeyOrders(newOutputKeyOrders)
            }}
            onRemove={vi.fn()}
          />
        )
      }

      render(<Harness />)
      return { state, renames }
    }

    it('should keep the declared type of a row whose name is typed through', async () => {
      const user = userEvent.setup()
      const { state, renames } = renderControlled(
        createOutputs({ a: 'array[object]', var_2: 'string' }),
        ['a', 'var_2'],
      )

      const input = screen.getAllByRole('textbox')[1]!
      await user.clear(input)
      await user.type(input, 'ab')

      expect(state.outputs).toEqual({
        a: { type: 'array[object]', children: null },
        ab: { type: 'string', children: null },
      })
      expect(state.outputKeyOrders).toEqual(['a', 'ab'])
      expect(input).toHaveValue('ab')
      // The transient name is never reported as a rename, so references to `a` stay on row 1
      expect(renames).toEqual([
        { from: 'var_2', to: '' },
        { from: '', to: 'ab' },
      ])
    })

    it('should restore the row name when the field is left while it still collides', async () => {
      const user = userEvent.setup()
      const { state, renames } = renderControlled(
        createOutputs({ a: 'array[object]', ab: 'string' }),
        ['a', 'ab'],
      )

      const input = screen.getAllByRole('textbox')[1]!
      await user.type(input, '{Backspace}')
      expect(input).toHaveValue('a')

      await user.tab()

      expect(input).toHaveValue('ab')
      expect(renames).toEqual([])
      expect(state.outputs).toEqual({
        a: { type: 'array[object]', children: null },
        ab: { type: 'string', children: null },
      })
    })
  })

  describe('removal with duplicate names', () => {
    it('should call onRemove with correct index when removing a duplicate', () => {
      const outputs = createOutputs({ var_1: 'string' })
      const onRemove = vi.fn()

      render(
        <OutputVarList
          readonly={false}
          outputs={outputs}
          outputKeyOrders={['var_1', 'var_1']}
          onChange={vi.fn()}
          onRemove={onRemove}
        />,
      )

      // The second remove button (index 1 in the row)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1]!)

      expect(onRemove).toHaveBeenCalledWith(1)
    })
  })

  describe('normal operation', () => {
    it('should render one row per outputKeyOrders entry', () => {
      const outputs = createOutputs({ a: 'string', b: 'number' })
      const onChange = vi.fn()

      render(
        <OutputVarList
          readonly={false}
          outputs={outputs}
          outputKeyOrders={['a', 'b']}
          onChange={onChange}
          onRemove={vi.fn()}
        />,
      )

      const inputs = screen.getAllByRole('textbox')
      expect(inputs).toHaveLength(2)
      expect(inputs[0])!.toHaveValue('a')
      expect(inputs[1])!.toHaveValue('b')
    })

    it('should call onChange with updated outputs when renaming', () => {
      const outputs = createOutputs({ var_1: 'string' })
      const onChange = vi.fn()

      render(
        <OutputVarList
          readonly={false}
          outputs={outputs}
          outputKeyOrders={['var_1']}
          onChange={onChange}
          onRemove={vi.fn()}
        />,
      )

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new_name' } })

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          new_name: { type: 'string', children: null },
        }),
        0,
        'new_name',
      )
    })

    it('should call onRemove when remove button is clicked', () => {
      const outputs = createOutputs({ var_1: 'string' })
      const onRemove = vi.fn()

      render(
        <OutputVarList
          readonly={false}
          outputs={outputs}
          outputKeyOrders={['var_1']}
          onChange={vi.fn()}
          onRemove={onRemove}
        />,
      )

      fireEvent.click(screen.getByRole('button'))

      expect(onRemove).toHaveBeenCalledWith(0)
    })

    it('should render inputs as readonly when readonly is true', () => {
      const outputs = createOutputs({ var_1: 'string' })

      render(
        <OutputVarList
          readonly={true}
          outputs={outputs}
          outputKeyOrders={['var_1']}
          onChange={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.getByRole('textbox'))!.toHaveAttribute('readonly')
    })
  })
})
