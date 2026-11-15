import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import type { Variable } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import VarList from '../var-list'

const initialVariables: Variable[] = ['alpha', 'beta', 'gamma'].map((variable) => ({
  variable,
  value_selector: ['source', variable],
  value_type: VarType.string,
}))

function SortableVariables({
  initial = initialVariables,
  readonly = false,
}: {
  initial?: Variable[]
  readonly?: boolean
}) {
  const [variables, setVariables] = useState(initial)
  return (
    <>
      <VarList nodeId="consumer" readonly={readonly} list={variables} onChange={setVariables} />
      <output aria-label="Saved variables">{JSON.stringify(variables)}</output>
    </>
  )
}

const renderVariables = (props: Parameters<typeof SortableVariables>[0] = {}) => {
  const sourceData: CodeNodeType = {
    title: 'Source',
    desc: '',
    type: BlockEnum.Code,
    code_language: CodeLanguage.javascript,
    code: 'function main() { return {} }',
    variables: [],
    outputs: Object.fromEntries(
      initialVariables.map(({ variable }) => [variable, { type: VarType.string, children: null }]),
    ),
  }
  const source = createNode({
    id: 'source',
    data: sourceData,
  })
  const consumerData: CodeNodeType = {
    title: 'Consumer',
    desc: '',
    type: BlockEnum.Code,
    code_language: CodeLanguage.javascript,
    code: 'function main() { return {} }',
    variables: initialVariables,
    outputs: {},
  }
  const consumer = createNode({ id: 'consumer', data: consumerData })
  return renderWorkflowEditor(<SortableVariables {...props} />, {
    nodes: [source, consumer],
    edges: [
      createEdge({
        source: 'source',
        target: 'consumer',
        data: { sourceType: BlockEnum.Code, targetType: BlockEnum.Code },
      }),
    ],
    initialStoreState: { isWorkflowDataLoaded: true },
    reactFlowProps: {
      edgesFocusable: false,
      nodesFocusable: false,
      proOptions: { hideAttribution: true },
    },
  })
}

const savedVariables = () => screen.getByRole('status', { name: 'Saved variables' })

describe('VarList', () => {
  it('normalizes a variable name through its labeled input', async () => {
    const user = userEvent.setup()
    renderVariables({ initial: [initialVariables[0]!] })

    const input = screen.getByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' })
    await user.clear(input)
    await user.paste('renamed input')

    expect(savedVariables()).toHaveTextContent(
      JSON.stringify([{ ...initialVariables[0], variable: 'renamed_input' }]),
    )
  })

  it('tabs through each variable from the reorder handle to its name, value actions and remove button', async () => {
    const user = userEvent.setup()
    renderVariables()
    const handles = screen.getAllByRole('button', { pressed: false })
    const names = screen.getAllByRole('textbox', {
      name: 'workflow.common.variableNamePlaceholder',
    })
    const values = initialVariables.map(({ variable }) =>
      screen.getByRole('button', { name: new RegExp(`Source.*${variable}.*string`) }),
    )
    const clearButtons = screen.getAllByRole('button', { name: 'common.operation.clear' })
    const pickerFocusTargets = screen.getAllByRole('textbox', { name: '' })
    const removeButtons = screen.getAllByRole('button', { name: 'common.operation.remove' })

    for (let index = 0; index < initialVariables.length; index++) {
      for (const control of [
        handles[index],
        names[index],
        values[index],
        clearButtons[index],
        pickerFocusTargets[index],
        removeButtons[index],
      ]) {
        await user.tab()
        expect(control).toHaveFocus()
      }
    }

    await user.tab({ shift: true })
    expect(pickerFocusTargets[2]).toHaveFocus()
    await user.tab({ shift: true })
    expect(clearButtons[2]).toHaveFocus()
    await user.tab({ shift: true })
    expect(values[2]).toHaveFocus()
    await user.tab({ shift: true })
    expect(names[2]).toHaveFocus()
    await user.tab({ shift: true })
    expect(handles[2]).toHaveFocus()
  })

  it('previews variable ordering, commits only on confirmation, and keeps the moved handle focused', async () => {
    const user = userEvent.setup()
    renderVariables()
    const handle = screen.getAllByRole('button', { pressed: false })[0]!
    await user.tab()
    expect(handle).toHaveFocus()
    await user.keyboard('{Enter}{ArrowDown}')
    expect(
      screen
        .getAllByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['beta', 'alpha', 'gamma'])
    expect(savedVariables()).toHaveTextContent(JSON.stringify(initialVariables))
    expect(screen.getByRole('button', { pressed: true })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(savedVariables()).toHaveTextContent(
      JSON.stringify([initialVariables[1], initialVariables[0], initialVariables[2]]),
    )
    expect(screen.getAllByRole('button', { pressed: false })[1]).toHaveFocus()
  })

  it('cancels a variable reorder and leaves arrow keys inside name inputs available for editing', async () => {
    const user = userEvent.setup()
    renderVariables()
    await user.tab()
    await user.tab()
    expect(
      screen.getAllByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' })[0],
    ).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(savedVariables()).toHaveTextContent(JSON.stringify(initialVariables))
    const handle = screen.getAllByRole('button', { pressed: false })[0]!
    await user.tab({ shift: true })
    expect(handle).toHaveFocus()
    await user.keyboard(' {ArrowDown}{Escape}')
    expect(
      screen
        .getAllByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['alpha', 'beta', 'gamma'])
    expect(savedVariables()).toHaveTextContent(JSON.stringify(initialVariables))
    expect(handle).toHaveFocus()
  })

  it('does not expose variable sorting in readonly mode', () => {
    renderVariables({ readonly: true })
    expect(screen.queryByRole('button', { pressed: false })).not.toBeInTheDocument()
    expect(savedVariables()).toHaveTextContent(JSON.stringify(initialVariables))
  })

  it('cancels a preview before deleting the variable whose remove button was activated', async () => {
    const user = userEvent.setup()
    renderVariables()
    const handle = screen.getAllByRole('button', { pressed: false })[0]!
    await user.tab()
    expect(handle).toHaveFocus()
    await user.keyboard('{Enter}{ArrowDown}')
    await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
    expect(savedVariables()).toHaveTextContent(
      JSON.stringify([initialVariables[1], initialVariables[2]]),
    )
    expect(
      screen
        .getAllByRole('textbox', { name: 'workflow.common.variableNamePlaceholder' })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['beta', 'gamma'])
  })
})
