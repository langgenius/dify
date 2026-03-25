/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { QuestionClassifierNodeType, Topic } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useUpdateNodeInternals } from 'reactflow'
import {
  useModelListAndDefaultModelAndCurrentProviderAndModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import PreviewNode from '@/app/components/workflow/workflow-preview/components/nodes/question-classifier/node'
import { createTFunction } from '@/test/i18n-mock'
import { useEdgesInteractions, useIsChatMode, useNodesReadOnly, useWorkflow } from '../../../hooks'
import useConfigVision from '../../../hooks/use-config-vision'
import { useStore } from '../../../store'
import AdvancedSetting from '../components/advanced-setting'
import ClassItem from '../components/class-item'
import { getCanonicalClassLabel, getDefaultClassLabel, getDisplayClassLabel } from '../components/class-label-utils'
import ClassList from '../components/class-list'
import nodeDefault from '../default'
import Node from '../node'
import Panel from '../panel'
import useConfig from '../use-config'

const questionClassifierTranslations = {
  'workflow.nodes.questionClassifiers.addClass': 'Add Class',
  'workflow.nodes.questionClassifiers.class': 'Class',
  'workflow.nodes.questionClassifiers.labelEditorAriaLabel': 'Class label editor',
  'workflow.nodes.questionClassifiers.renameHint': 'Double-click class title to rename',
  'workflow.nodes.questionClassifiers.defaultLabel': 'CLASS {{index}}',
  'nodes.questionClassifiers.addClass': 'Add Class',
  'nodes.questionClassifiers.class': 'Class',
  'nodes.questionClassifiers.labelEditorAriaLabel': 'Class label editor',
  'nodes.questionClassifiers.renameHint': 'Double-click class title to rename',
  'nodes.questionClassifiers.defaultLabel': 'CLASS {{index}}',
}

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const t = (key: string, options?: Record<string, string | number>) => {
    const ns = typeof options?.ns === 'string' ? options.ns : undefined
    const fullKey = ns ? `${ns}.${key}` : key
    const template = questionClassifierTranslations[fullKey as keyof typeof questionClassifierTranslations]
      ?? questionClassifierTranslations[key as keyof typeof questionClassifierTranslations]
      ?? fullKey

    if (!options)
      return template

    return Object.entries(options).reduce((result, [name, value]) => (
      result.replace(`{{${name}}}`, String(value))
    ), template)
  }

  return {
    ...actual,
    useTranslation: () => ({
      t,
      i18n: {
        changeLanguage: vi.fn(),
        language: 'en-US',
      },
    }),
  }
})

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  default: ({ title, value, onChange, onRemove, showRemove, headerClassName }: any) => (
    <div>
      <div className={headerClassName}>{title}</div>
      <input aria-label="topic-editor" value={value} onChange={event => onChange(event.target.value)} />
      {showRemove && <button type="button" onClick={onRemove}>remove-item</button>}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/memory-config', () => ({
  default: ({ onChange }: any) => <button type="button" onClick={() => onChange({ enabled: true })}>memory-config</button>,
}))

vi.mock('../../_base/hooks/use-available-var-list', () => ({
  default: vi.fn(() => ({
    availableVars: [{ variable: ['node-1', 'answer'], type: VarType.string }],
    availableNodesWithParent: [{ id: 'node-1', data: { title: 'Answer', type: BlockEnum.Answer } }],
  })),
}))

vi.mock('../../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks')>()
  return {
    ...actual,
    useEdgesInteractions: vi.fn(),
    useIsChatMode: vi.fn(),
    useNodesReadOnly: vi.fn(),
    useWorkflow: vi.fn(),
  }
})

vi.mock('../../../store', () => ({
  useStore: vi.fn(),
}))

vi.mock('../../../hooks/use-config-vision', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  default: vi.fn(),
}))

vi.mock('reactflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('reactflow')>()
  return {
    ...actual,
    useUpdateNodeInternals: vi.fn(),
  }
})

vi.mock('@/app/components/workflow/nodes/_base/components/add-button', () => ({
  default: ({ text, onClick }: any) => <button type="button" onClick={onClick}>{text}</button>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: vi.fn(),
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel }: any) => <div>{defaultModel.provider}:{defaultModel.model}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/readonly-input-with-select-var', () => ({
  default: ({ value }: any) => <div>{value}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/node-handle', () => ({
  NodeSourceHandle: ({ handleId }: any) => <div>handle-{handleId}</div>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: ({ setModel, onCompletionParamsChange }: any) => (
    <div>
      <button type="button" onClick={() => setModel({ provider: 'openai', name: 'gpt-4o' })}>set-model</button>
      <button type="button" onClick={() => onCompletionParamsChange({ temperature: 0.2 })}>set-params</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/collapse', () => ({
  FieldCollapse: ({ title, children }: any) => <div><div>{title}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, operations, children }: any) => <div><div>{title}</div><div>{operations}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children }: any) => <div>{children}</div>,
  VarItem: ({ name, type }: any) => <div>{name}:{type}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/config-vision', () => ({
  default: ({ onEnabledChange, onConfigChange }: any) => (
    <div>
      <button type="button" onClick={() => onEnabledChange(true)}>vision-toggle</button>
      <button type="button" onClick={() => onConfigChange({ resolution: 'high' })}>vision-config</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange }: any) => <button type="button" onClick={() => onChange(['node-1', 'query'])}>var-picker</button>,
}))

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

const mockUseEdgesInteractions = vi.mocked(useEdgesInteractions)
const mockUseTextGeneration = vi.mocked(useTextGenerationCurrentProviderAndModelAndModelList)
const mockUseModelListAndDefaultModelAndCurrentProviderAndModel = vi.mocked(useModelListAndDefaultModelAndCurrentProviderAndModel)
const mockUseIsChatMode = vi.mocked(useIsChatMode)
const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseWorkflow = vi.mocked(useWorkflow)
const mockUseStore = vi.mocked(useStore)
const mockUseConfigVision = vi.mocked(useConfigVision)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseUpdateNodeInternals = vi.mocked(useUpdateNodeInternals)
const mockUseConfig = vi.mocked(useConfig)

type TopicWithLabel = Topic & { label?: string }

const createTopic = (overrides: Partial<TopicWithLabel> = {}): TopicWithLabel => ({
  id: 'topic-1',
  name: 'Billing questions',
  label: 'CLASS 1',
  ...overrides,
})

const createData = (overrides: Partial<QuestionClassifierNodeType> = {}): QuestionClassifierNodeType => ({
  title: 'Question Classifier',
  desc: '',
  type: BlockEnum.QuestionClassifier,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  },
  classes: [createTopic()],
  query_variable_selector: ['node-1', 'query'],
  instruction: 'Route by topic',
  memory: undefined,
  vision: {
    enabled: false,
  },
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  handleModelChanged: vi.fn(),
  isChatMode: true,
  isChatModel: true,
  handleCompletionParamsChange: vi.fn(),
  handleQueryVarChange: vi.fn(),
  filterVar: vi.fn(() => true),
  handleTopicsChange: vi.fn(),
  hasSetBlockStatus: { context: false, history: false, query: false },
  availableVars: [],
  availableNodesWithParent: [],
  availableVisionVars: [],
  handleInstructionChange: vi.fn(),
  handleMemoryChange: vi.fn(),
  isVisionModel: true,
  handleVisionResolutionEnabledChange: vi.fn(),
  handleVisionResolutionChange: vi.fn(),
  handleSortTopic: vi.fn(),
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

const renderPanel = (data: QuestionClassifierNodeType = createData()) => (
  render(<Panel id="node-1" data={data} panelProps={panelProps} />)
)

describe('question-classifier path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEdgesInteractions.mockReturnValue({
      handleEdgeDeleteByDeleteBranch: vi.fn(),
    } as unknown as ReturnType<typeof useEdgesInteractions>)
    mockUseTextGeneration.mockReturnValue({
      currentProvider: undefined,
      currentModel: undefined,
      textGenerationModelList: [{ provider: 'openai', model: 'gpt-4o', status: 'active' } as any],
      activeTextGenerationModelList: [{ provider: 'openai', model: 'gpt-4o', status: 'active' } as any],
    })
    mockUseModelListAndDefaultModelAndCurrentProviderAndModel.mockReturnValue({
      currentProvider: undefined,
      currentModel: undefined,
      textGenerationModelList: [],
      activeTextGenerationModelList: [],
    } as any)
    mockUseConfig.mockReturnValue(createConfigResult())
    mockUseIsChatMode.mockReturnValue(true)
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false } as any)
    mockUseWorkflow.mockReturnValue({
      getBeforeNodesInSameBranch: vi.fn(() => []),
    } as any)
    mockUseStore.mockImplementation((selector: any) => selector({ nodesDefaultConfigs: {} }))
    mockUseConfigVision.mockReturnValue({
      isVisionModel: false,
      handleVisionResolutionEnabledChange: vi.fn(),
      handleVisionResolutionChange: vi.fn(),
      handleModelChanged: vi.fn(),
    } as any)
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs: vi.fn(),
    } as any)
    mockUseUpdateNodeInternals.mockReturnValue(vi.fn())
  })

  // The question classifier path should wire editor-based classes, model display, and panel controls together.
  describe('Path Integration', () => {
    it('should keep explicit class labels in the default config', () => {
      expect(nodeDefault.defaultValue.classes).toEqual([
        { id: '1', name: '', label: 'CLASS 1' },
        { id: '2', name: '', label: 'CLASS 2' },
      ])
    })

    it('should fall back to canonical defaults when the locale key is missing and still allow localized display defaults', () => {
      const missingKeyT = createTFunction({}, 'workflow')
      const localizedT = createTFunction({
        'workflow.nodes.questionClassifiers.defaultLabel': '分类 {{index}}',
      }, 'workflow')

      expect(getDefaultClassLabel(missingKeyT as any, 2)).toBe('CLASS 2')
      expect(getDisplayClassLabel(undefined, 2, missingKeyT as any)).toBe('CLASS 2')
      expect(getDisplayClassLabel(undefined, 1, localizedT as any)).toBe('分类 1')
      expect(getCanonicalClassLabel('分类 1', 1, localizedT as any)).toBe('CLASS 1')
    })

    it('should render advanced settings and memory config', async () => {
      const user = userEvent.setup()
      const onInstructionChange = vi.fn()
      const onMemoryChange = vi.fn()

      render(
        <AdvancedSetting
          instruction="Route by topic"
          onInstructionChange={onInstructionChange}
          hideMemorySetting={false}
          onMemoryChange={onMemoryChange}
          isChatModel
          isChatApp
          nodesOutputVars={[]}
          availableNodes={[]}
        />,
      )

      await user.type(screen.getByDisplayValue('Route by topic'), '!')
      await user.click(screen.getByText('memory-config'))

      expect(onInstructionChange).toHaveBeenCalled()
      expect(onMemoryChange).toHaveBeenCalledWith({ enabled: true })
    })

    it('should edit and remove a single class item', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onRemove = vi.fn()

      render(
        <ClassItem
          nodeId="node-1"
          payload={createTopic()}
          onChange={onChange}
          onRemove={onRemove}
          index={1}
          filterVar={() => true}
        />,
      )

      await user.type(screen.getByDisplayValue('Billing questions'), ' updated')
      await user.click(screen.getByText('remove-item'))

      expect(onChange).toHaveBeenCalled()
      expect(onRemove).toHaveBeenCalled()
    })

    it('should add classes and collapse the class list', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { container } = render(
        <ClassList
          nodeId="node-1"
          list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      await user.click(screen.getByText('Add Class'))
      await user.click(screen.getByText('Class'))
      expect(screen.queryByText('Add Class')).not.toBeInTheDocument()
      await user.click(screen.getByText('Class'))
      expect(screen.getByText('Add Class')).toBeInTheDocument()
      expect(container.querySelector('.handle')).not.toBeNull()

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'topic-1', label: 'CLASS 1' }),
        expect.objectContaining({ id: 'topic-2', label: 'CLASS 1' }),
        expect.objectContaining({ name: '', label: 'CLASS 3' }),
      ])
    })

    it('should save an inline class label edit when the header is double-clicked and Enter is pressed', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic()]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      await user.dblClick(screen.getByText('CLASS 1'))
      const inlineEditor = screen.getByDisplayValue('CLASS 1')
      await user.clear(inlineEditor)
      await user.type(inlineEditor, 'Priority billing{Enter}')

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'topic-1', label: 'Priority billing' }),
      ])
    })

    it('should start inline class label editing from the header button with Enter', async () => {
      const user = userEvent.setup()

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic()]}
          onChange={vi.fn()}
          filterVar={() => true}
        />,
      )

      const headerButton = screen.getByRole('button', { name: 'CLASS 1' })
      headerButton.focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('textbox', { name: 'Class label editor' })).toHaveValue('CLASS 1')
    })

    it('should start inline class label editing from the header button with Space', async () => {
      const user = userEvent.setup()

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic()]}
          onChange={vi.fn()}
          filterVar={() => true}
        />,
      )

      const headerButton = screen.getByRole('button', { name: 'CLASS 1' })
      headerButton.focus()
      await user.keyboard(' ')

      expect(screen.getByRole('textbox', { name: 'Class label editor' })).toHaveValue('CLASS 1')
    })

    it('should save an inline class label edit on blur and normalize empty labels back to the default title', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      const { rerender } = render(
        <ClassList
          nodeId="node-1"
          list={[createTopic()]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      await user.dblClick(screen.getByText('CLASS 1'))
      const renamedInput = screen.getByDisplayValue('CLASS 1')
      await user.clear(renamedInput)
      await user.type(renamedInput, 'Refund routing')
      fireEvent.blur(renamedInput)

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'topic-1', label: 'Refund routing' }),
      ])

      rerender(
        <ClassList
          nodeId="node-1"
          list={[createTopic({ label: 'Refund routing' })]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      await user.dblClick(screen.getByText('Refund routing'))
      const emptyInput = screen.getByDisplayValue('Refund routing')
      await user.clear(emptyInput)
      fireEvent.blur(emptyInput)

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'topic-1', label: 'CLASS 1' }),
      ])
    })

    it('should preserve the user-provided label casing in editable headers', () => {
      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic({ label: 'AsKing Flow' })]}
          onChange={vi.fn()}
          filterVar={() => true}
        />,
      )

      const headerButton = screen.getByRole('button', { name: 'AsKing Flow' })
      expect(headerButton).not.toHaveClass('uppercase')
    })

    it('should cancel inline class label editing on Escape and restore the previous value', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic({ label: 'Billing triage' })]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      await user.dblClick(screen.getByText('Billing triage'))
      const inlineEditor = screen.getByDisplayValue('Billing triage')
      await user.clear(inlineEditor)
      await user.type(inlineEditor, 'Temporary label')
      fireEvent.keyDown(inlineEditor, { key: 'Escape' })

      expect(screen.getByText('Billing triage')).toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalledWith([
        expect.objectContaining({ id: 'topic-1', label: 'Temporary label' }),
      ])
    })

    it('should normalize whitespace labels on read and keep the rename hint visible for them', async () => {
      const user = userEvent.setup()

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic({ label: '   ' })]}
          onChange={vi.fn()}
          filterVar={() => true}
        />,
      )

      expect(screen.getByRole('button', { name: 'CLASS 1' })).toBeInTheDocument()
      expect(screen.getByText('Double-click class title to rename')).toBeInTheDocument()

      await user.dblClick(screen.getByRole('button', { name: 'CLASS 1' }))
      expect(screen.getByRole('textbox', { name: 'Class label editor' })).toHaveValue('CLASS 1')
    })

    it('should canonicalize a whitespace-only stored label when saving without meaningful edits', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic({ label: '   ' })]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      await user.dblClick(screen.getByRole('button', { name: 'CLASS 1' }))
      fireEvent.blur(screen.getByRole('textbox', { name: 'Class label editor' }))

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'topic-1', label: 'CLASS 1' }),
      ])
    })

    it('should canonicalize a localized default label back to CLASS N when saving', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <ClassItem
          nodeId="node-1"
          payload={createTopic({ label: '分类 1' })}
          onChange={onChange}
          onRemove={vi.fn()}
          index={1}
          filterVar={() => true}
        />,
      )

      await user.dblClick(screen.getByText('分类 1'))
      fireEvent.blur(screen.getByRole('textbox', { name: 'Class label editor' }))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        id: 'topic-1',
        label: 'CLASS 1',
      }))
    })

    it('should canonicalize a translated default from another locale when the active UI locale differs', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <ClassItem
          nodeId="node-1"
          payload={createTopic({ label: '分类 1' })}
          onChange={onChange}
          onRemove={vi.fn()}
          index={1}
          filterVar={() => true}
        />,
      )

      await user.dblClick(screen.getByText('分类 1'))
      fireEvent.blur(screen.getByRole('textbox', { name: 'Class label editor' }))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        id: 'topic-1',
        label: 'CLASS 1',
      }))
    })

    it('should render a non-interactive title in readonly mode', () => {
      render(
        <ClassItem
          nodeId="node-1"
          payload={createTopic()}
          onChange={vi.fn()}
          onRemove={vi.fn()}
          index={1}
          filterVar={() => true}
          readonly
        />,
      )

      expect(screen.queryByRole('button', { name: 'CLASS 1' })).not.toBeInTheDocument()
      expect(screen.getByText('CLASS 1')).toBeInTheDocument()
    })

    it('should show the rename hint once for default-labeled classes', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const storageKey = 'question-classifier-inline-label-hint-dismissed'

      const { rerender } = render(
        <ClassList
          nodeId="node-1"
          list={[createTopic()]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      expect(screen.getByText('Double-click class title to rename')).toBeInTheDocument()

      await user.dblClick(screen.getByText('CLASS 1'))
      await user.type(screen.getByDisplayValue('CLASS 1'), '{Enter}')

      expect(localStorage.setItem).toHaveBeenCalledWith(storageKey, 'true')

      rerender(
        <ClassList
          nodeId="node-1"
          list={[createTopic()]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      expect(screen.queryByText('Double-click class title to rename')).not.toBeInTheDocument()
    })

    it('should keep rendering and allow editing when localStorage access fails', async () => {
      const user = userEvent.setup()
      const originalLocalStorage = globalThis.localStorage
      const failingLocalStorage = {
        getItem: vi.fn(() => {
          throw new Error('storage unavailable')
        }),
        setItem: vi.fn(() => {
          throw new Error('storage unavailable')
        }),
        removeItem: vi.fn(),
        clear: vi.fn(),
      }
      Object.defineProperty(globalThis, 'localStorage', {
        value: failingLocalStorage,
        writable: true,
        configurable: true,
      })

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic()]}
          onChange={vi.fn()}
          filterVar={() => true}
        />,
      )

      expect(screen.getByText('Double-click class title to rename')).toBeInTheDocument()

      const headerButton = screen.getByRole('button', { name: 'CLASS 1' })
      headerButton.focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('textbox', { name: 'Class label editor' })).toBeInTheDocument()
      expect(failingLocalStorage.getItem).toHaveBeenCalled()

      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      })
    })

    it('should update and remove classes from the class list and delete the related edge branch', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const handleEdgeDeleteByDeleteBranch = vi.fn()
      mockUseEdgesInteractions.mockReturnValueOnce({
        handleEdgeDeleteByDeleteBranch,
      } as unknown as ReturnType<typeof useEdgesInteractions>)

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('Billing questions'), { target: { value: 'Updated billing' } })
      await user.click(screen.getAllByText('remove-item')[0]!)

      expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ name: 'Updated billing' }),
      ]))
      expect(handleEdgeDeleteByDeleteBranch).toHaveBeenCalledWith('node-1', 'topic-1')
    })

    it('should disable dragging and hide the add button when the class list is readonly', () => {
      const { container } = render(
        <ClassList
          nodeId="node-1"
          list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
          onChange={vi.fn()}
          filterVar={() => true}
          readonly
        />,
      )

      expect(screen.queryByText('Add Class')).not.toBeInTheDocument()
      expect(container.querySelector('.handle')).toBeNull()
    })

    it('should render the node model and output handles for each class', () => {
      renderWorkflowFlowComponent(
        <Node
          id="node-1"
          data={createData({
            classes: [
              createTopic({ label: 'AsKing' }),
              createTopic({ id: 'topic-2', name: 'Refunds', label: 'TalkIng' }),
            ],
          })}
          type="custom"
          selected={false}
          zIndex={1}
          xPos={0}
          yPos={0}
          dragging={false}
          isConnectable
        />,
        { nodes: [], edges: [] },
      )

      expect(screen.getByText('openai:gpt-4o')).toBeInTheDocument()
      expect(screen.getByText('AsKing')).toBeInTheDocument()
      expect(screen.getByText('TalkIng')).toBeInTheDocument()
      expect(screen.getByText('Billing questions')).toBeInTheDocument()
      expect(screen.getByText('Refunds')).toBeInTheDocument()
      expect(screen.getByText('AsKing')).not.toHaveClass('uppercase')
      expect(screen.getByText('handle-topic-1')).toBeInTheDocument()
      expect(screen.getByText('handle-topic-2')).toBeInTheDocument()
    })

    it('should render the node when only classes are set and return null when both model and classes are missing', async () => {
      const user = userEvent.setup()
      const longTopicName = 'L'.repeat(60)
      const { rerender } = renderWorkflowFlowComponent(
        <Node
          id="node-1"
          data={createData({
            model: { provider: '', name: '', mode: 'chat', completion_params: {} },
            classes: [createTopic({ id: 'topic-2', name: longTopicName, label: 'ASKING' })],
          })}
          type="custom"
          selected={false}
          zIndex={1}
          xPos={0}
          yPos={0}
          dragging={false}
          isConnectable
        />,
        { nodes: [], edges: [] },
      )

      expect(screen.getByText('ASKING')).toBeInTheDocument()
      expect(screen.getByText(`${longTopicName.slice(0, 50)}...`)).toBeInTheDocument()
      await user.hover(screen.getByText(`${longTopicName.slice(0, 50)}...`))
      expect(screen.getByText(longTopicName)).toBeInTheDocument()

      rerender(
        <Node
          id="node-1"
          data={createData({
            model: { provider: '', name: '', mode: 'chat', completion_params: {} },
            classes: [],
          })}
          type="custom"
          selected={false}
          zIndex={1}
          xPos={0}
          yPos={0}
          dragging={false}
          isConnectable
        />,
      )

      expect(screen.queryByText('openai:gpt-4o')).not.toBeInTheDocument()
      expect(screen.queryByText(`${longTopicName.slice(0, 50)}...`)).not.toBeInTheDocument()
    })

    it('should render class labels as titles and topic names in the workflow preview node', () => {
      renderWorkflowFlowComponent(
        <PreviewNode
          id="node-1"
          data={createData({
            classes: [
              createTopic({ id: 'topic-1', name: 'users are asking questions', label: 'AsKing' }),
              createTopic({ id: 'topic-2', name: 'users are just chill talking', label: 'TalkIng' }),
            ],
          })}
          type="custom"
          selected={false}
          zIndex={1}
          xPos={0}
          yPos={0}
          dragging={false}
          isConnectable
        />,
        { nodes: [], edges: [] },
      )

      expect(screen.getByText('AsKing')).toBeInTheDocument()
      expect(screen.getByText('TalkIng')).toBeInTheDocument()
      expect(screen.getByText('users are asking questions')).toBeInTheDocument()
      expect(screen.getByText('users are just chill talking')).toBeInTheDocument()
      expect(screen.getByText('AsKing')).not.toHaveClass('uppercase')
    })

    it('should render the panel controls and output variables', async () => {
      const user = userEvent.setup()
      renderPanel()

      await user.click(screen.getByText('set-model'))
      await user.click(screen.getByText('set-params'))
      await user.click(screen.getAllByText('var-picker')[0]!)
      await user.click(screen.getByText('vision-toggle'))
      await user.click(screen.getByText('vision-config'))

      expect(screen.getByText('class_name:string')).toBeInTheDocument()
      expect(screen.getByText('class_label:string')).toBeInTheDocument()
      expect(screen.getByText('usage:object')).toBeInTheDocument()
    })

    it('should preserve class labels when sorting classes', async () => {
      const { default: realUseConfig } = await vi.importActual<typeof import('../use-config')>('../use-config')
      const setInputs = vi.fn()
      const updateNodeInternals = vi.fn()
      const labeledTopic: TopicWithLabel = { id: 'topic-1', name: 'Billing questions', label: 'CLASS 1' }
      const legacyTopic: TopicWithLabel = { id: 'topic-2', name: 'Refunds' }
      const payload = createData({
        classes: [labeledTopic, legacyTopic] as Topic[],
      })

      mockUseNodeCrud.mockReturnValue({
        inputs: payload,
        setInputs,
      } as any)
      mockUseUpdateNodeInternals.mockReturnValue(updateNodeInternals)

      const { result } = renderHook(() => realUseConfig('node-1', payload))

      result.current.handleSortTopic([legacyTopic, labeledTopic] as (Topic & { id: string })[])

      expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
        classes: [
          expect.objectContaining({ id: 'topic-2', name: 'Refunds' }),
          expect.objectContaining({ id: 'topic-1', name: 'Billing questions', label: 'CLASS 1' }),
        ],
        _targetBranches: [
          { id: 'topic-2', name: 'Refunds' },
          { id: 'topic-1', name: 'Billing questions' },
        ],
      }))
      expect(updateNodeInternals).toHaveBeenCalledWith('node-1')
    })

    it('should strip class labels from target branches when updating classes', async () => {
      const { default: realUseConfig } = await vi.importActual<typeof import('../use-config')>('../use-config')
      const setInputs = vi.fn()
      const labeledTopic: TopicWithLabel = { id: 'topic-1', name: 'Billing questions', label: 'CLASS 1' }
      const legacyTopic: TopicWithLabel = { id: 'topic-2', name: 'Refunds' }
      const payload = createData({
        classes: [labeledTopic, legacyTopic] as Topic[],
      })

      mockUseNodeCrud.mockReturnValue({
        inputs: payload,
        setInputs,
      } as any)

      const { result } = renderHook(() => realUseConfig('node-1', payload))

      result.current.handleTopicsChange([labeledTopic, legacyTopic] as Topic[])

      expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
        classes: [
          expect.objectContaining({ id: 'topic-1', name: 'Billing questions', label: 'CLASS 1' }),
          expect.objectContaining({ id: 'topic-2', name: 'Refunds' }),
        ],
        _targetBranches: [
          { id: 'topic-1', name: 'Billing questions' },
          { id: 'topic-2', name: 'Refunds' },
        ],
      }))
    })
  })
})
