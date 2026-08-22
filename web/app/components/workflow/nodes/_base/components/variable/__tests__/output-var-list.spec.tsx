import type { OutputVar } from '../../../../code/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('@langgenius/dify-ui/toast', () => ({
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
  // Returns the outputs after the rename: the payload passed to onChange, or the outputs
  // unchanged when the rename was not committed.
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

    return captured ?? outputs
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

    it('should keep both entries alive when a name transits an existing one and is then made unique', () => {
      // Step 1: rename var_2 -> var_1 (creates duplicate)
      const outputs = createOutputs({ var_1: 'string', var_2: 'number' })
      const afterFirst = collectRenameResult(outputs, ['var_1', 'var_2'], 1, 'var_1')

      // outputs is keyed by name, so committing this rename would overwrite var_1's entry with
      // var_2's. The rename is held until the name is unique, so var_2 keeps its own entry.
      expect(afterFirst.var_2).toBeDefined()
      expect(afterFirst.var_1).toBeDefined()

      // Clean up first render before the second to avoid DOM collision
      cleanup()

      // Step 2: rename second var_1 -> var_2 (restores unique names)
      const afterSecond = collectRenameResult(afterFirst, ['var_1', 'var_1'], 1, 'var_2')

      // var_1 must survive because index 0 still uses it
      expect(afterSecond.var_1).toBeDefined()
      expect(afterSecond.var_2).toBeDefined()
    })
  })

  describe('typing a name that another row already holds', () => {
    // The component is controlled, so a multi-keystroke test has to feed each change back the way
    // the owning hook does. This mirrors use-output-var-list's handleVarsChange: outputs are
    // replaced, the changed row is pointed at the new key, and a rename is announced to the nodes
    // referencing the old name.
    const renderControlled = (outputs: OutputVar, outputKeyOrders: string[]) => {
      const state = { outputs, outputKeyOrders }
      const announcedRenames: Array<{ oldName: string; newName: string }> = []

      const Harness = () => {
        const [currentOutputs, setCurrentOutputs] = useState(outputs)
        const [currentOrders, setCurrentOrders] = useState(outputKeyOrders)

        return (
          <OutputVarList
            readonly={false}
            outputs={currentOutputs}
            outputKeyOrders={currentOrders}
            onChange={(newOutputs, changedIndex, newKey) => {
              const nextOrders =
                changedIndex === undefined
                  ? currentOrders
                  : currentOrders.map((key, i) => (i === changedIndex ? newKey! : key))

              if (newKey && changedIndex !== undefined)
                announcedRenames.push({ oldName: currentOrders[changedIndex]!, newName: newKey })

              state.outputs = newOutputs
              state.outputKeyOrders = nextOrders
              setCurrentOutputs(newOutputs)
              setCurrentOrders(nextOrders)
            }}
            onRemove={vi.fn()}
          />
        )
      }

      render(<Harness />)
      const nameInputAt = (index: number) => screen.getAllByRole('textbox')[index]!
      return { state, announcedRenames, nameInputAt }
    }

    const twoRows = () => createOutputs({ a: 'array[object]', var_2: 'string' })

    it('should keep the first row declared type when a later row transits its name', () => {
      const afterTransit = collectRenameResult(twoRows(), ['a', 'var_2'], 1, 'a')

      // The row being edited is not the row whose type this is. Committing the collision would
      // overwrite the array[object] declaration with the string one.
      expect(afterTransit.a).toEqual({ type: 'array[object]', children: null })
      expect(afterTransit.var_2).toEqual({ type: 'string', children: null })
    })

    it('should not give a row another row type when typing past its name', () => {
      const { state, nameInputAt } = renderControlled(twoRows(), ['a', 'var_2'])

      fireEvent.change(nameInputAt(1), { target: { value: 'a' } })
      fireEvent.change(nameInputAt(1), { target: { value: 'ab' } })

      expect(state.outputs.a).toEqual({ type: 'array[object]', children: null })
      expect(state.outputs.ab).toEqual({ type: 'string', children: null })
      // The row moved off var_2 in one committed step, so nothing is left behind unreachable.
      expect(state.outputs.var_2).toBeUndefined()
      expect(Object.keys(state.outputs)).toHaveLength(2)
      expect(state.outputKeyOrders).toEqual(['a', 'ab'])
    })

    it('should not announce a rename while the typed name collides', () => {
      const { announcedRenames, nameInputAt } = renderControlled(twoRows(), ['a', 'var_2'])

      fireEvent.change(nameInputAt(1), { target: { value: 'a' } })

      // Renames are matched by name, so announcing this one would later repoint the first row's
      // references onto this row.
      expect(announcedRenames).toEqual([])

      fireEvent.change(nameInputAt(1), { target: { value: 'ab' } })

      expect(announcedRenames).toEqual([{ oldName: 'var_2', newName: 'ab' }])
    })

    it('should restore the committed name when the field is left while the name collides', () => {
      const { state, nameInputAt } = renderControlled(twoRows(), ['a', 'var_2'])

      fireEvent.change(nameInputAt(1), { target: { value: 'a' } })
      expect(nameInputAt(1)).toHaveValue('a')

      fireEvent.blur(nameInputAt(1))

      expect(nameInputAt(1)).toHaveValue('var_2')
      expect(state.outputs.var_2).toEqual({ type: 'string', children: null })
      expect(state.outputKeyOrders).toEqual(['a', 'var_2'])
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
