import type { LexicalEditor } from 'lexical'
import type {
  ContextBlockType,
  CurrentBlockType,
  ErrorMessageBlockType,
  ExternalToolBlockType,
  ExternalToolOption,
  HistoryBlockType,
  LastRunBlockType,
  Option,
  QueryBlockType,
  RequestURLBlockType,
  VariableBlockType,
  WorkflowVariableBlockType,
} from '../../types'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { renderHook } from '@testing-library/react'
import * as React from 'react'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { VarType } from '@/app/components/workflow/types'
import { CustomTextNode } from '../custom-text/node'
import {
  useExternalToolOptions,
  useOptions,
  usePromptOptions,
  useVariableOptions,
} from './hooks'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Minimal LexicalComposer wrapper required by useLexicalComposerContext().
 * The actual editor nodes registered here are empty – hooks only need the
 * context to call dispatchCommand / update.
 *
 * Note: A new wrapper is created per describe block so each describe block has
 * its own isolated Lexical instance.
 */
function makeLexicalWrapper() {
  const initialConfig = {
    namespace: 'hooks-test',
    onError: (err: Error) => { throw err },
    // CustomTextNode must be registered so editor.update() in addOption's onSelect can create it
    nodes: [CustomTextNode],
  }
  return function LexicalWrapper({ children }: { children: React.ReactNode }) {
    return (
      <LexicalComposer initialConfig={initialConfig}>
        {children}
      </LexicalComposer>
    )
  }
}

// ─── Factory helpers (typed, no `any` / `never`) ─────────────────────────────

function makeContextBlock(overrides: Partial<ContextBlockType> = {}): ContextBlockType {
  return { show: true, selectable: true, ...overrides }
}

function makeQueryBlock(overrides: Partial<QueryBlockType> = {}): QueryBlockType {
  return { show: true, selectable: true, ...overrides }
}

function makeHistoryBlock(overrides: Partial<HistoryBlockType> = {}): HistoryBlockType {
  return { show: true, selectable: true, ...overrides }
}

function makeRequestURLBlock(overrides: Partial<RequestURLBlockType> = {}): RequestURLBlockType {
  return { show: true, selectable: true, ...overrides }
}

function makeVariableBlock(variables: Option[] = [], overrides: Partial<VariableBlockType> = {}): VariableBlockType {
  return { show: true, variables, ...overrides }
}

function makeExternalToolBlock(
  overrides: Partial<ExternalToolBlockType> = {},
  tools: ExternalToolOption[] = [],
): ExternalToolBlockType {
  return { show: true, externalTools: tools, ...overrides }
}

function makeWorkflowVariableBlock(
  variables: NodeOutPutVar[] = [],
  overrides: Partial<WorkflowVariableBlockType> = {},
): WorkflowVariableBlockType {
  return { show: true, variables, ...overrides }
}

function makeVar(variable: string, type: VarType = VarType.string) {
  return { variable, type }
}

function makeNodeOutPutVar(nodeId: string, title: string, vars: ReturnType<typeof makeVar>[] = []): NodeOutPutVar {
  return { nodeId, title, vars }
}

// ─── Shared mock render-prop arguments ───────────────────────────────────────
// These are the props passed to renderMenuOption() in option objects
const renderProps = {
  isSelected: false,
  onSelect: vi.fn(),
  onSetHighlight: vi.fn(),
  queryString: null as string | null,
}

// ═══════════════════════════════════════════════════════════════════════════════
// usePromptOptions
// ═══════════════════════════════════════════════════════════════════════════════
describe('usePromptOptions', () => {
  // Ensure clean spy state before every test
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const wrapper = makeLexicalWrapper()

  /**
   * When all blocks are undefined (not passed) the hook should return an empty array.
   * This is the "no blocks configured" base case.
   */
  describe('when no blocks are provided', () => {
    it('should return an empty array', () => {
      const { result } = renderHook(() => usePromptOptions(), { wrapper })
      expect(result.current).toHaveLength(0)
    })
  })

  /**
   * contextBlock has two states: show=false (hidden) and show=true (visible).
   * When show=false the option must NOT be included.
   */
  describe('contextBlock', () => {
    it('should NOT include context option when show is false', () => {
      const { result } = renderHook(
        () => usePromptOptions(makeContextBlock({ show: false })),
        { wrapper },
      )
      expect(result.current).toHaveLength(0)
    })

    it('should include context option when show is true', () => {
      const { result } = renderHook(
        () => usePromptOptions(makeContextBlock({ show: true })),
        { wrapper },
      )
      expect(result.current).toHaveLength(1)
      expect(result.current[0].group).toBe('prompt context')
    })

    it('should render the context PromptMenuItem without crashing', () => {
      const { result } = renderHook(
        () => usePromptOptions(makeContextBlock()),
        { wrapper },
      )
      // renderMenuOption returns a React element – just verify it's truthy
      const el = result.current[0].renderMenuOption(renderProps)
      expect(el).toBeTruthy()
    })

    it('should dispatch INSERT_CONTEXT_BLOCK_COMMAND when selectable and onSelectMenuOption is called', () => {
      // Capture the editor from within the same renderHook callback so we can spy on it
      let capturedEditor: LexicalEditor | null = null

      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return usePromptOptions(makeContextBlock({ selectable: true }))
        },
        { wrapper },
      )

      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('should NOT dispatch any command when selectable is false', () => {
      let capturedEditor: LexicalEditor | null = null

      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return usePromptOptions(makeContextBlock({ selectable: false }))
        },
        { wrapper },
      )

      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  /**
   * queryBlock mirrors contextBlock: hidden when show=false, visible and dispatching when show=true.
   */
  describe('queryBlock', () => {
    it('should NOT include query option when show is false', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, makeQueryBlock({ show: false })),
        { wrapper },
      )
      expect(result.current).toHaveLength(0)
    })

    it('should include query option when show is true', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, makeQueryBlock()),
        { wrapper },
      )
      expect(result.current).toHaveLength(1)
      expect(result.current[0].group).toBe('prompt query')
    })

    it('should render the query PromptMenuItem without crashing', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, makeQueryBlock()),
        { wrapper },
      )
      const el = result.current[0].renderMenuOption(renderProps)
      expect(el).toBeTruthy()
    })

    it('should dispatch INSERT_QUERY_BLOCK_COMMAND when selectable', () => {
      let capturedEditor: LexicalEditor | null = null
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return usePromptOptions(undefined, makeQueryBlock({ selectable: true }))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('should NOT dispatch command when selectable is false', () => {
      let capturedEditor: LexicalEditor | null = null
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return usePromptOptions(undefined, makeQueryBlock({ selectable: false }))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  /**
   * requestURLBlock – added in third position when show=true.
   */
  describe('requestURLBlock', () => {
    it('should NOT include request URL option when show is false', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, undefined, undefined, makeRequestURLBlock({ show: false })),
        { wrapper },
      )
      expect(result.current).toHaveLength(0)
    })

    it('should include request URL option when show is true', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, undefined, undefined, makeRequestURLBlock()),
        { wrapper },
      )
      expect(result.current).toHaveLength(1)
      expect(result.current[0].group).toBe('request URL')
    })

    it('should render the requestURL PromptMenuItem without crashing', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, undefined, undefined, makeRequestURLBlock()),
        { wrapper },
      )
      const el = result.current[0].renderMenuOption(renderProps)
      expect(el).toBeTruthy()
    })

    it('should dispatch INSERT_REQUEST_URL_BLOCK_COMMAND when selectable', () => {
      let capturedEditor: LexicalEditor | null = null
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return usePromptOptions(undefined, undefined, undefined, makeRequestURLBlock({ selectable: true }))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('should NOT dispatch command when selectable is false', () => {
      let capturedEditor: LexicalEditor | null = null
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return usePromptOptions(undefined, undefined, undefined, makeRequestURLBlock({ selectable: false }))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  /**
   * historyBlock – added last when show=true.
   */
  describe('historyBlock', () => {
    it('should NOT include history option when show is false', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, undefined, makeHistoryBlock({ show: false })),
        { wrapper },
      )
      expect(result.current).toHaveLength(0)
    })

    it('should include history option when show is true', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, undefined, makeHistoryBlock()),
        { wrapper },
      )
      expect(result.current).toHaveLength(1)
      expect(result.current[0].group).toBe('prompt history')
    })

    it('should render the history PromptMenuItem without crashing', () => {
      const { result } = renderHook(
        () => usePromptOptions(undefined, undefined, makeHistoryBlock()),
        { wrapper },
      )
      const el = result.current[0].renderMenuOption(renderProps)
      expect(el).toBeTruthy()
    })

    it('should dispatch INSERT_HISTORY_BLOCK_COMMAND when selectable', () => {
      let capturedEditor: LexicalEditor | null = null
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return usePromptOptions(undefined, undefined, makeHistoryBlock({ selectable: true }))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('should NOT dispatch command when selectable is false', () => {
      let capturedEditor: LexicalEditor | null = null
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return usePromptOptions(undefined, undefined, makeHistoryBlock({ selectable: false }))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  /**
   * All four blocks shown simultaneously – verify all four options are produced
   * in the correct order: context → query → requestURL → history.
   * (requestURL is pushed after query but BEFORE history because the source pushes
   * requestURLBlock before historyBlock.)
   */
  describe('all blocks visible', () => {
    it('should return all four options in correct order', () => {
      const { result } = renderHook(
        () => usePromptOptions(
          makeContextBlock(),
          makeQueryBlock(),
          makeHistoryBlock(),
          makeRequestURLBlock(),
        ),
        { wrapper },
      )
      expect(result.current).toHaveLength(4)
      expect(result.current[0].group).toBe('prompt context')
      expect(result.current[1].group).toBe('prompt query')
      // requestURL is pushed 3rd – before historyBlock
      expect(result.current[2].group).toBe('request URL')
      expect(result.current[3].group).toBe('prompt history')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// useVariableOptions
// ═══════════════════════════════════════════════════════════════════════════════
describe('useVariableOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const wrapper = makeLexicalWrapper()

  /**
   * Show=false edge case: the hook must return [] even when variables are present.
   */
  describe('when variableBlock.show is false', () => {
    it('should return an empty array', () => {
      const { result } = renderHook(
        () => useVariableOptions(makeVariableBlock([{ value: 'foo', name: 'foo' }], { show: false })),
        { wrapper },
      )
      expect(result.current).toHaveLength(0)
    })
  })

  /**
   * Undefined variableBlock – hook should return [].
   */
  describe('when variableBlock is undefined', () => {
    it('should return an empty array', () => {
      const { result } = renderHook(
        () => useVariableOptions(undefined),
        { wrapper },
      )
      expect(result.current).toHaveLength(0)
    })
  })

  /**
   * variableBlock.variables is undefined while show=true – only addOption is returned
   * because the inner `options` memo short-circuits to [] when `variableBlock.variables`
   * is falsy, and the final memo includes addOption when show=true.
   */
  describe('when variableBlock.variables is undefined', () => {
    it('should return only the addOption', () => {
      const { result } = renderHook(
        () => useVariableOptions({ show: true, variables: undefined }),
        { wrapper },
      )
      expect(result.current).toHaveLength(1)
      expect(result.current[0].group).toBe('prompt variable')
    })
  })

  /**
   * No queryString – all variables are returned plus the addOption.
   */
  describe('with variables and no queryString', () => {
    it('should return all variables + addOption', () => {
      const vars: Option[] = [
        { value: 'alpha', name: 'Alpha' },
        { value: 'beta', name: 'Beta' },
      ]
      const { result } = renderHook(
        () => useVariableOptions(makeVariableBlock(vars)),
        { wrapper },
      )
      // 2 variable options + 1 addOption = 3
      expect(result.current).toHaveLength(3)
      expect(result.current[0].key).toBe('alpha')
      expect(result.current[1].key).toBe('beta')
    })

    it('should render variable VariableMenuItems without crashing', () => {
      const vars: Option[] = [{ value: 'myvar', name: 'My Var' }]
      const { result } = renderHook(
        () => useVariableOptions(makeVariableBlock(vars)),
        { wrapper },
      )
      // Pass a queryString so we exercise the highlight splitting code path in VariableMenuItem
      const el = result.current[0].renderMenuOption({ ...renderProps, queryString: 'my' })
      expect(el).toBeTruthy()
    })

    it('should dispatch INSERT_VARIABLE_VALUE_BLOCK_COMMAND with correct payload when variable is selected', () => {
      let capturedEditor: LexicalEditor | null = null
      const vars: Option[] = [{ value: 'myvar', name: 'My Var' }]
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return useVariableOptions(makeVariableBlock(vars))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      // The command payload wraps the value in {{ }}
      expect(spy).toHaveBeenCalledWith(expect.anything(), '{{myvar}}')
    })
  })

  /**
   * queryString filtering: only variable keys that match the regex survive.
   */
  describe('with queryString filtering', () => {
    it('should filter variables by queryString (case-insensitive)', () => {
      const vars: Option[] = [
        { value: 'alpha', name: 'Alpha' },
        { value: 'beta', name: 'Beta' },
        { value: 'ALPHA_UPPER', name: 'ALPHA_UPPER' },
      ]
      const { result } = renderHook(
        () => useVariableOptions(makeVariableBlock(vars), 'alpha'),
        { wrapper },
      )
      // 'alpha' regex (case-insensitive) matches 'alpha' and 'ALPHA_UPPER'; addOption is always appended
      expect(result.current).toHaveLength(3)
      expect(result.current[0].key).toBe('alpha')
      expect(result.current[1].key).toBe('ALPHA_UPPER')
    })

    it('should return only addOption when no variables match the queryString', () => {
      const vars: Option[] = [
        { value: 'alpha', name: 'Alpha' },
        { value: 'beta', name: 'Beta' },
      ]
      const { result } = renderHook(
        () => useVariableOptions(makeVariableBlock(vars), 'zzz'),
        { wrapper },
      )
      // No match → filtered options=[] + addOption = 1
      expect(result.current).toHaveLength(1)
    })
  })

  /**
   * addOption – calling onSelectMenuOption triggers editor.update() which
   * in turn calls $insertNodes with {{ and }} custom text nodes.
   * We only verify update() was invoked since the full DOM mutation requires
   * a real Lexical document with registered nodes.
   */
  describe('addOption (the last element)', () => {
    it('should render addOption VariableMenuItem without crashing', () => {
      const { result } = renderHook(
        () => useVariableOptions(makeVariableBlock([])),
        { wrapper },
      )
      const lastOption = result.current[result.current.length - 1]
      const el = lastOption.renderMenuOption(renderProps)
      expect(el).toBeTruthy()
    })

    it('should call editor.update() when addOption is selected', () => {
      let capturedEditor: LexicalEditor | null = null
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return useVariableOptions(makeVariableBlock([]))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'update')
      const lastOption = result.current[result.current.length - 1]
      lastOption.onSelectMenuOption()
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// useExternalToolOptions
// ═══════════════════════════════════════════════════════════════════════════════
describe('useExternalToolOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const wrapper = makeLexicalWrapper()

  const sampleTool: ExternalToolOption = {
    name: 'weather',
    variableName: 'weather_tool',
    icon: 'cloud',
    icon_background: '#fff',
  }

  /**
   * Show=false: must always return [].
   */
  describe('when externalToolBlockType.show is false', () => {
    it('should return an empty array', () => {
      const { result } = renderHook(
        () => useExternalToolOptions(makeExternalToolBlock({ show: false }, [sampleTool])),
        { wrapper },
      )
      expect(result.current).toHaveLength(0)
    })
  })

  /**
   * Undefined block: return [].
   */
  describe('when externalToolBlockType is undefined', () => {
    it('should return an empty array', () => {
      const { result } = renderHook(
        () => useExternalToolOptions(undefined),
        { wrapper },
      )
      expect(result.current).toHaveLength(0)
    })
  })

  /**
   * externalTools is undefined while show=true – inner options memo returns [] because
   * `externalToolBlockType?.externalTools` is falsy. Only addOption is in the result.
   */
  describe('when externalTools is undefined', () => {
    it('should return only the addOption', () => {
      const { result } = renderHook(
        () => useExternalToolOptions({ show: true, externalTools: undefined }),
        { wrapper },
      )
      expect(result.current).toHaveLength(1)
      expect(result.current[0].group).toBe('external tool')
    })
  })

  /**
   * Tools with no queryString – all tools + addOption.
   */
  describe('with tools and no queryString', () => {
    it('should return all tools + addOption', () => {
      const tools: ExternalToolOption[] = [
        { name: 'tool-a', variableName: 'tool_a' },
        { name: 'tool-b', variableName: 'tool_b' },
      ]
      const { result } = renderHook(
        () => useExternalToolOptions(makeExternalToolBlock({}, tools)),
        { wrapper },
      )
      expect(result.current).toHaveLength(3)
      expect(result.current[0].key).toBe('tool-a')
      expect(result.current[1].key).toBe('tool-b')
    })

    it('should render tool VariableMenuItem (with AppIcon and variableName extra element) without crashing', () => {
      const { result } = renderHook(
        () => useExternalToolOptions(makeExternalToolBlock({}, [sampleTool])),
        { wrapper },
      )
      // pass a queryString to also exercise the highlighting code path
      const el = result.current[0].renderMenuOption({ ...renderProps, queryString: 'wea' })
      expect(el).toBeTruthy()
    })

    it('should dispatch INSERT_VARIABLE_VALUE_BLOCK_COMMAND with variableName when tool is selected', () => {
      let capturedEditor: LexicalEditor | null = null
      const { result } = renderHook(
        () => {
          const [editor] = useLexicalComposerContext()
          capturedEditor = editor
          return useExternalToolOptions(makeExternalToolBlock({}, [sampleTool]))
        },
        { wrapper },
      )
      const spy = vi.spyOn(capturedEditor!, 'dispatchCommand')
      result.current[0].onSelectMenuOption()
      // variableName is 'weather_tool', wrapped in {{ }}
      expect(spy).toHaveBeenCalledWith(expect.anything(), '{{weather_tool}}')
    })
  })

  /**
   * queryString filtering – case-insensitive match against the tool's `name` key.
   */
  describe('with queryString filtering', () => {
    it('should filter tools by queryString (case-insensitive)', () => {
      const tools: ExternalToolOption[] = [
        { name: 'WeatherTool', variableName: 'weather' },
        { name: 'SearchTool', variableName: 'search' },
      ]
      const { result } = renderHook(
        () => useExternalToolOptions(makeExternalToolBlock({}, tools), 'weather'),
        { wrapper },
      )
      // 'weather' regex matches 'WeatherTool'; addOption is always appended
      expect(result.current).toHaveLength(2)
      expect(result.current[0].key).toBe('WeatherTool')
    })

    it('should return only addOption when no tools match', () => {
      const tools: ExternalToolOption[] = [{ name: 'Alpha', variableName: 'alpha' }]
      const { result } = renderHook(
        () => useExternalToolOptions(makeExternalToolBlock({}, tools), 'zzz'),
        { wrapper },
      )
      expect(result.current).toHaveLength(1)
    })
  })

  /**
   * addOption – last element in the array.
   * Its onSelect calls externalToolBlockType.onAddExternalTool() if provided.
   */
  describe('addOption (the last element)', () => {
    it('should render addOption VariableMenuItem (with Tool03/ArrowUpRight icons) without crashing', () => {
      const { result } = renderHook(
        () => useExternalToolOptions(makeExternalToolBlock({}, [])),
        { wrapper },
      )
      const lastOption = result.current[result.current.length - 1]
      const el = lastOption.renderMenuOption(renderProps)
      expect(el).toBeTruthy()
    })

    it('should call onAddExternalTool when addOption is selected and callback provided', () => {
      const onAddExternalTool = vi.fn()
      const { result } = renderHook(
        () => useExternalToolOptions(makeExternalToolBlock({ onAddExternalTool }, [])),
        { wrapper },
      )
      const lastOption = result.current[result.current.length - 1]
      lastOption.onSelectMenuOption()
      expect(onAddExternalTool).toHaveBeenCalledTimes(1)
    })

    it('should NOT throw when onAddExternalTool is undefined and addOption is selected', () => {
      // Covers the optional-chaining branch: externalToolBlockType?.onAddExternalTool?.()
      const block = makeExternalToolBlock({}, [])
      delete block.onAddExternalTool
      const { result } = renderHook(
        () => useExternalToolOptions(block),
        { wrapper },
      )
      const lastOption = result.current[result.current.length - 1]
      expect(() => lastOption.onSelectMenuOption()).not.toThrow()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// useOptions
// ═══════════════════════════════════════════════════════════════════════════════
describe('useOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const wrapper = makeLexicalWrapper()

  /**
   * Base case: no arguments → both arrays empty.
   */
  describe('with no arguments', () => {
    it('should return empty workflowVariableOptions and allFlattenOptions', () => {
      const { result } = renderHook(() => useOptions(), { wrapper })
      expect(result.current.workflowVariableOptions).toHaveLength(0)
      expect(result.current.allFlattenOptions).toHaveLength(0)
    })
  })

  /**
   * allFlattenOptions = promptOptions + variableOptions + externalToolOptions.
   */
  describe('allFlattenOptions aggregation', () => {
    it('should combine prompt, variable, and external tool options', () => {
      const { result } = renderHook(
        () => useOptions(
          makeContextBlock(), // 1 prompt option
          undefined,
          undefined,
          makeVariableBlock([{ value: 'v1', name: 'v1' }]), // 1 var + 1 addOption = 2
          makeExternalToolBlock({}, [{ name: 't1', variableName: 'tv1' }]), // 1 tool + 1 addOption = 2
        ),
        { wrapper },
      )
      // 1 + 2 + 2 = 5
      expect(result.current.allFlattenOptions).toHaveLength(5)
    })
  })

  /**
   * workflowVariableOptions – show=false must return [].
   */
  describe('workflowVariableOptions when show is false', () => {
    it('should return empty array', () => {
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock([], { show: false }),
        ),
        { wrapper },
      )
      expect(result.current.workflowVariableOptions).toHaveLength(0)
    })
  })

  /**
   * workflowVariableOptions with existing variables but no synthetic node injection.
   */
  describe('workflowVariableOptions with plain variables', () => {
    it('should return variables as-is when no special blocks are shown', () => {
      const vars: NodeOutPutVar[] = [
        makeNodeOutPutVar('node-1', 'Node One', [makeVar('out', VarType.string)]),
      ]
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock(vars),
        ),
        { wrapper },
      )
      expect(result.current.workflowVariableOptions).toHaveLength(1)
      expect(result.current.workflowVariableOptions[0].nodeId).toBe('node-1')
    })
  })

  /**
   * workflowVariableBlockType.variables is undefined → defaults to [] via `|| []`.
   */
  describe('workflowVariableOptions when variables is undefined', () => {
    it('should default to empty array', () => {
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { show: true, variables: undefined },
        ),
        { wrapper },
      )
      // No special block injections and no variables → empty array
      expect(result.current.workflowVariableOptions).toHaveLength(0)
    })
  })

  /**
   * errorMessageBlockType.show=true and 'error_message' NOT already in the list
   * → a synthetic error_message node is prepended via Array.unshift().
   */
  describe('errorMessageBlockType injection', () => {
    it('should prepend error_message node when show is true and not already present', () => {
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock([]),
          undefined,
          undefined,
                    { show: true } satisfies ErrorMessageBlockType,
        ),
        { wrapper },
      )
      expect(result.current.workflowVariableOptions[0].nodeId).toBe('error_message')
      expect(result.current.workflowVariableOptions[0].vars[0].variable).toBe('error_message')
      expect(result.current.workflowVariableOptions[0].vars[0].type).toBe(VarType.string)
    })

    it('should NOT inject error_message when already present in variables', () => {
      // The findIndex check ensures deduplication
      const existingVars: NodeOutPutVar[] = [
        makeNodeOutPutVar('error_message', 'error_message', [makeVar('error_message', VarType.string)]),
      ]
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock(existingVars),
          undefined,
          undefined,
                    { show: true } satisfies ErrorMessageBlockType,
        ),
        { wrapper },
      )
      // Should still be 1, not 2
      const errorNodes = result.current.workflowVariableOptions.filter(v => v.nodeId === 'error_message')
      expect(errorNodes).toHaveLength(1)
    })

    it('should NOT inject error_message when errorMessageBlockType.show is false', () => {
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock([]),
          undefined,
          undefined,
                    { show: false } satisfies ErrorMessageBlockType,
        ),
        { wrapper },
      )
      const errorNodes = result.current.workflowVariableOptions.filter(v => v.nodeId === 'error_message')
      expect(errorNodes).toHaveLength(0)
    })
  })

  /**
   * lastRunBlockType.show=true → prepends a 'last_run' synthetic node with VarType.object.
   */
  describe('lastRunBlockType injection', () => {
    it('should prepend last_run node when show is true and not already present', () => {
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock([]),
          undefined,
          undefined,
          undefined,
                    { show: true } satisfies LastRunBlockType,
        ),
        { wrapper },
      )
      expect(result.current.workflowVariableOptions[0].nodeId).toBe('last_run')
      expect(result.current.workflowVariableOptions[0].vars[0].type).toBe(VarType.object)
    })

    it('should NOT inject last_run when already present in variables', () => {
      const existingVars: NodeOutPutVar[] = [
        makeNodeOutPutVar('last_run', 'last_run', [makeVar('last_run', VarType.object)]),
      ]
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock(existingVars),
          undefined,
          undefined,
          undefined,
                    { show: true } satisfies LastRunBlockType,
        ),
        { wrapper },
      )
      const lastRunNodes = result.current.workflowVariableOptions.filter(v => v.nodeId === 'last_run')
      expect(lastRunNodes).toHaveLength(1)
    })

    it('should NOT inject last_run when lastRunBlockType.show is false', () => {
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock([]),
          undefined,
          undefined,
          undefined,
                    { show: false } satisfies LastRunBlockType,
        ),
        { wrapper },
      )
      const lastRunNodes = result.current.workflowVariableOptions.filter(v => v.nodeId === 'last_run')
      expect(lastRunNodes).toHaveLength(0)
    })
  })

  /**
   * currentBlockType injection:
   *  - When generatorType === 'prompt' the title should be 'current_prompt'.
   *  - Otherwise the title should be 'current_code'.
   */
  describe('currentBlockType injection', () => {
    it('should prepend current node with title "current_prompt" when generatorType is prompt', () => {
      const currentBlock: CurrentBlockType = { show: true, generatorType: GeneratorType.prompt }
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock([]),
          undefined,
          currentBlock,
        ),
        { wrapper },
      )
      const currentNode = result.current.workflowVariableOptions.find(v => v.nodeId === 'current')
      expect(currentNode).toBeDefined()
      expect(currentNode!.title).toBe('current_prompt')
      expect(currentNode!.vars[0].type).toBe(VarType.string)
    })

    it('should prepend current node with title "current_code" when generatorType is not prompt', () => {
      // Any generatorType value other than 'prompt' results in 'current_code'
      const currentBlock: CurrentBlockType = { show: true, generatorType: GeneratorType.code }
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock([]),
          undefined,
          currentBlock,
        ),
        { wrapper },
      )
      const currentNode = result.current.workflowVariableOptions.find(v => v.nodeId === 'current')
      expect(currentNode).toBeDefined()
      expect(currentNode!.title).toBe('current_code')
    })

    it('should NOT inject current node when already present', () => {
      // The findIndex guard prevents double-injection
      const existingVars: NodeOutPutVar[] = [
        makeNodeOutPutVar('current', 'current_prompt', [makeVar('current', VarType.string)]),
      ]
      const currentBlock: CurrentBlockType = { show: true, generatorType: GeneratorType.prompt }
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock(existingVars),
          undefined,
          currentBlock,
        ),
        { wrapper },
      )
      const currentNodes = result.current.workflowVariableOptions.filter(v => v.nodeId === 'current')
      expect(currentNodes).toHaveLength(1)
    })

    it('should NOT inject current node when currentBlockType.show is false', () => {
      const currentBlock: CurrentBlockType = { show: false, generatorType: GeneratorType.prompt }
      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock([]),
          undefined,
          currentBlock,
        ),
        { wrapper },
      )
      const currentNodes = result.current.workflowVariableOptions.filter(v => v.nodeId === 'current')
      expect(currentNodes).toHaveLength(0)
    })
  })

  /**
   * Stacking order: when all three special blocks (error_message, last_run, current)
   * are shown, they are prepended with Array.unshift() in the order:
   *   1. unshift(error_message)  → [error_message, ...base]
   *   2. unshift(last_run)       → [last_run, error_message, ...base]
   *   3. unshift(current)        → [current, last_run, error_message, ...base]
   */
  describe('stacking order of injected nodes', () => {
    it('should place current first, then last_run, then error_message, then base vars', () => {
      const baseVars: NodeOutPutVar[] = [makeNodeOutPutVar('base-node', 'Base', [])]
      const currentBlock: CurrentBlockType = { show: true, generatorType: GeneratorType.prompt }
      const errorBlock: ErrorMessageBlockType = { show: true }
      const lastRunBlock: LastRunBlockType = { show: true }

      const { result } = renderHook(
        () => useOptions(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          makeWorkflowVariableBlock(baseVars),
          undefined,
          currentBlock,
          errorBlock,
          lastRunBlock,
        ),
        { wrapper },
      )

      const ids = result.current.workflowVariableOptions.map(v => v.nodeId)
      // current is unshifted last, so it ends up at index 0
      expect(ids[0]).toBe('current')
      expect(ids[1]).toBe('last_run')
      expect(ids[2]).toBe('error_message')
      expect(ids[3]).toBe('base-node')
    })
  })

  /**
   * Full integration: all prompt blocks visible + variables + tools + workflow vars +
   * all three special injections active.
   */
  describe('full integration scenario', () => {
    it('should return correct combined options when all block types are configured', () => {
      const vars: Option[] = [{ value: 'v1', name: 'v1' }]
      const tools: ExternalToolOption[] = [{ name: 'tool1', variableName: 'tv1' }]
      const wfVars: NodeOutPutVar[] = [makeNodeOutPutVar('node-x', 'NodeX', [])]

      const { result } = renderHook(
        () => useOptions(
          makeContextBlock(),
          makeQueryBlock(),
          makeHistoryBlock(),
          makeVariableBlock(vars),
          makeExternalToolBlock({}, tools),
          makeWorkflowVariableBlock(wfVars),
          makeRequestURLBlock(),
                    { show: true, generatorType: GeneratorType.prompt } satisfies CurrentBlockType,
                    { show: true } satisfies ErrorMessageBlockType,
                    { show: true } satisfies LastRunBlockType,
                    'v1',
        ),
        { wrapper },
      )

      // allFlattenOptions: 4 prompt + variable options (v1 matches, + addOption) + tool options (tool1 does NOT match 'v1' → 0 + addOption)
      // = 4 + 2 + 1 = 7
      expect(result.current.allFlattenOptions).toHaveLength(7)

      // workflowVariableOptions: current + last_run + error_message + node-x = 4
      expect(result.current.workflowVariableOptions).toHaveLength(4)
      expect(result.current.workflowVariableOptions[0].nodeId).toBe('current')
      expect(result.current.workflowVariableOptions[1].nodeId).toBe('last_run')
      expect(result.current.workflowVariableOptions[2].nodeId).toBe('error_message')
      expect(result.current.workflowVariableOptions[3].nodeId).toBe('node-x')
    })
  })
})
