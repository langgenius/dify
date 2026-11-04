import type { LexicalCommand } from 'lexical'
import type { ReactNode } from 'react'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, renderHook } from '@testing-library/react'
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { VarType } from '@/app/components/workflow/types'
import { INSERT_CONTEXT_BLOCK_COMMAND } from '../../context-block'
import { CustomTextNode } from '../../custom-text/node'
import { INSERT_HISTORY_BLOCK_COMMAND } from '../../history-block'
import { INSERT_QUERY_BLOCK_COMMAND } from '../../query-block'
import { INSERT_REQUEST_URL_BLOCK_COMMAND } from '../../request-url-block'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '../../variable-block'
import { useExternalToolOptions, useOptions, usePromptOptions, useVariableOptions } from '../hooks'

const wrapper = ({ children }: { children: ReactNode }) => (
  <LexicalComposer
    initialConfig={{
      namespace: 'picker-options',
      nodes: [CustomTextNode],
      onError: (error) => {
        throw error
      },
      editorState: () => {
        $getRoot().append($createParagraphNode()).selectEnd()
      },
    }}
  >
    {children}
  </LexicalComposer>
)

const available = { show: true, selectable: true }
const variables = [
  { value: 'alpha', name: 'Alpha' },
  { value: 'ALPHA_UPPER', name: 'Upper' },
  { value: 'beta', name: 'Beta' },
]
const tools = [
  { name: 'Weather [local]', variableName: 'weather' },
  { name: 'Search', variableName: 'search' },
]

function renderOptions<T>(useOptionsHook: () => T) {
  return renderHook(
    () => {
      const [editor] = useLexicalComposerContext()
      return { editor, options: useOptionsHook() }
    },
    { wrapper },
  )
}

describe('prompt picker options', () => {
  it('keeps prompt groups in menu order and routes each selection to its own command', () => {
    const { result } = renderOptions(() =>
      usePromptOptions(available, available, available, available),
    )
    expect(result.current.options.map((option) => option.group)).toEqual([
      'prompt context',
      'prompt query',
      'request URL',
      'prompt history',
    ])
    const received: string[] = []
    const commands: [LexicalCommand<void>, string][] = [
      [INSERT_CONTEXT_BLOCK_COMMAND, 'context'],
      [INSERT_QUERY_BLOCK_COMMAND, 'query'],
      [INSERT_REQUEST_URL_BLOCK_COMMAND, 'url'],
      [INSERT_HISTORY_BLOCK_COMMAND, 'history'],
    ]
    const unregister = commands.map(([command, name]) =>
      result.current.editor.registerCommand(
        command,
        () => {
          received.push(name)
          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
    act(() => result.current.options.forEach((option) => option.onSelectMenuOption()))
    expect(received).toEqual(['context', 'query', 'url', 'history'])
    unregister.forEach((remove) => remove())
  })

  it('omits hidden prompts and leaves visible unavailable prompts unselectable', () => {
    const { result } = renderOptions(() =>
      usePromptOptions(
        { show: false, selectable: true },
        { show: true, selectable: false },
        undefined,
        undefined,
      ),
    )
    expect(result.current.options.map((option) => option.group)).toEqual(['prompt query'])
    const onQuery = vi.fn(() => true)
    const remove = result.current.editor.registerCommand(
      INSERT_QUERY_BLOCK_COMMAND,
      onQuery,
      COMMAND_PRIORITY_EDITOR,
    )
    act(() => result.current.options[0]!.onSelectMenuOption())
    expect(onQuery).not.toHaveBeenCalled()
    remove()
  })

  it.each([
    { query: '', expected: ['alpha', 'ALPHA_UPPER', 'beta'] },
    { query: 'AlPhA', expected: ['alpha', 'ALPHA_UPPER'] },
    { query: '[', expected: [] },
    { query: '.', expected: [] },
  ])(
    'filters variable names literally for "$query" and keeps the add action',
    ({ query, expected }) => {
      const { result } = renderOptions(() => useVariableOptions({ show: true, variables }, query))
      expect(result.current.options.map((option) => option.key)).toEqual([
        ...expected,
        'common.promptEditor.variable.modal.add',
      ])
    },
  )

  it('inserts the variable key and external tool variable name through the variable command', () => {
    const { result } = renderOptions(() => ({
      variables: useVariableOptions({ show: true, variables }),
      tools: useExternalToolOptions({ show: true, externalTools: tools }),
    }))
    const values: unknown[] = []
    const remove = result.current.editor.registerCommand(
      INSERT_VARIABLE_VALUE_BLOCK_COMMAND,
      (value) => {
        values.push(value)
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    )
    act(() => {
      result.current.options.variables[0]!.onSelectMenuOption()
      result.current.options.tools[0]!.onSelectMenuOption()
    })
    expect(values).toEqual(['{{alpha}}', '{{weather}}'])
    remove()
  })

  it('adds an editable variable placeholder with the cursor between its braces', async () => {
    const { result } = renderOptions(() => useVariableOptions({ show: true, variables: [] }))
    await act(async () => result.current.options[0]!.onSelectMenuOption())
    result.current.editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('{{}}')
      const selection = $getSelection()
      expect($isRangeSelection(selection)).toBe(true)
      if (!$isRangeSelection(selection)) throw new Error('Expected editable variable selection')
      expect(selection.isCollapsed()).toBe(true)
      expect(selection.anchor.offset).toBe(2)
    })
  })

  it.each([
    { query: 'weATHER', expected: ['Weather [local]'] },
    { query: '[', expected: ['Weather [local]'] },
    { query: '.', expected: [] },
  ])(
    'filters external tools literally for "$query" and opens the add flow',
    ({ query, expected }) => {
      const onAddExternalTool = vi.fn()
      const { result } = renderOptions(() =>
        useExternalToolOptions({ show: true, externalTools: tools, onAddExternalTool }, query),
      )
      expect(result.current.options.map((option) => option.key)).toEqual([
        ...expected,
        'common.promptEditor.variable.modal.addTool',
      ])
      act(() => result.current.options.at(-1)!.onSelectMenuOption())
      expect(onAddExternalTool).toHaveBeenCalledExactlyOnceWith()
    },
  )

  it('combines enabled prompt, variable and external tool groups after search', () => {
    const { result } = renderOptions(() =>
      useOptions(
        available,
        available,
        available,
        { show: true, variables },
        { show: true, externalTools: tools },
        undefined,
        available,
        undefined,
        undefined,
        undefined,
        'alpha',
      ),
    )
    expect(
      result.current.options.allFlattenOptions.map((option) => [option.group, option.key]),
    ).toEqual([
      ['prompt context', 'common.promptEditor.context.item.title'],
      ['prompt query', 'common.promptEditor.query.item.title'],
      ['request URL', 'common.promptEditor.requestURL.item.title'],
      ['prompt history', 'common.promptEditor.history.item.title'],
      ['prompt variable', 'alpha'],
      ['prompt variable', 'ALPHA_UPPER'],
      ['prompt variable', 'common.promptEditor.variable.modal.add'],
      ['external tool', 'common.promptEditor.variable.modal.addTool'],
    ])
  })

  it('does not offer hidden variable and tool groups', () => {
    const { result } = renderOptions(() =>
      useOptions(
        undefined,
        undefined,
        undefined,
        { show: false, variables },
        { show: false, externalTools: tools },
        { show: false, variables: [] },
      ),
    )
    expect(result.current.options).toEqual({ workflowVariableOptions: [], allFlattenOptions: [] })
  })

  it('adds generator variables without mutating upstream variables or leaking them after a mode change', () => {
    const base: NodeOutPutVar[] = [
      { nodeId: 'node-1', title: 'Node one', vars: [{ variable: 'output', type: VarType.string }] },
    ]
    const original = structuredClone(base)
    const { result, rerender } = renderHook(
      ({ show, generatorType }: { show: boolean; generatorType: GeneratorType }) =>
        useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { show: true, variables: base },
          undefined,
          { show, generatorType },
          { show },
          { show },
        ),
      {
        wrapper,
        initialProps: { show: true, generatorType: GeneratorType.prompt as GeneratorType },
      },
    )
    expect(result.current.workflowVariableOptions).toEqual([
      {
        nodeId: 'current',
        title: 'current_prompt',
        isFlat: true,
        vars: [{ variable: 'current', type: VarType.string }],
      },
      {
        nodeId: 'last_run',
        title: 'last_run',
        isFlat: true,
        vars: [{ variable: 'last_run', type: VarType.object }],
      },
      {
        nodeId: 'error_message',
        title: 'error_message',
        isFlat: true,
        vars: [{ variable: 'error_message', type: VarType.string }],
      },
      ...original,
    ])
    expect(base).toEqual(original)
    rerender({ show: true, generatorType: GeneratorType.code })
    expect(result.current.workflowVariableOptions[0]!.title).toBe('current_code')
    rerender({ show: false, generatorType: GeneratorType.code })
    expect(result.current.workflowVariableOptions).toEqual(original)
  })

  it('preserves existing special variables without adding duplicates', () => {
    const existing: NodeOutPutVar[] = ['current', 'last_run', 'error_message'].map((nodeId) => ({
      nodeId,
      title: `Existing ${nodeId}`,
      vars: [{ variable: nodeId, type: VarType.object }],
    }))
    const { result } = renderOptions(() =>
      useOptions(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { show: true, variables: existing },
        undefined,
        { show: true, generatorType: GeneratorType.prompt as GeneratorType },
        { show: true },
        { show: true },
      ),
    )
    expect(result.current.options.workflowVariableOptions).toEqual(existing)
  })
})
