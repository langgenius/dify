import type { ReactNode } from 'react'
import type { IConfigVarProps } from '../index'
import type { ExternalDataTool } from '@/models/common'
import type { PromptVariable } from '@/models/debug'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { vi } from 'vite-plus/test'
import { toast } from '@/app/components/app/configuration/toast'
import DebugConfigurationContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createDebugConfigurationFixture } from '@/test/fixtures/debug-configuration'
import ConfigVar, { ADD_EXTERNAL_DATA_TOOL } from '../index'

const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')

const setShowExternalDataToolModal = vi.fn()

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({}),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalDataToolModal,
  }),
}))

type SortableItem = {
  id: string
  variable: PromptVariable
}

type SortableProps = {
  list: SortableItem[]
  setList: (list: SortableItem[]) => void
  children: ReactNode
}

let latestSortableProps: SortableProps | null = null

vi.mock('react-sortablejs', () => ({
  ReactSortable: (props: SortableProps) => {
    latestSortableProps = props
    return <div data-testid="sortable">{props.children}</div>
  },
}))

type DebugConfigurationState = React.ComponentProps<
  typeof DebugConfigurationContext.Provider
>['value']

const createDebugConfigValue = (overrides: Partial<DebugConfigurationState> = {}) =>
  createDebugConfigurationFixture(overrides)

function ExternalToolEventSource() {
  const { eventEmitter } = useEventEmitterContextContext()
  return (
    <button
      onClick={() =>
        eventEmitter?.emit({
          type: ADD_EXTERNAL_DATA_TOOL,
          payload: {
            variable: 'api_var',
            label: 'API Var',
            enabled: true,
            type: 'api',
            config: {},
            icon: 'icon',
            icon_background: 'bg',
          } satisfies ExternalDataTool,
        })
      }
    >
      Install external data tool
    </button>
  )
}

let variableIndex = 0
const createPromptVariable = (overrides: Partial<PromptVariable> = {}): PromptVariable => {
  variableIndex += 1
  return {
    key: `var_${variableIndex}`,
    name: `Variable ${variableIndex}`,
    type: 'string',
    required: false,
    ...overrides,
  }
}

const renderConfigVar = (
  props: Partial<IConfigVarProps> = {},
  debugOverrides: Partial<DebugConfigurationState> = {},
) => {
  const defaultProps: IConfigVarProps = {
    promptVariables: [],
    readonly: false,
    onPromptVariablesChange: vi.fn(),
  }

  const mergedProps = {
    ...defaultProps,
    ...props,
  }

  return render(
    <EventEmitterContextProvider>
      <ExternalToolEventSource />
      <DebugConfigurationContext.Provider value={createDebugConfigValue(debugOverrides)}>
        <ConfigVar {...mergedProps} />
      </DebugConfigurationContext.Provider>
    </EventEmitterContextProvider>,
  )
}

describe('ConfigVar', () => {
  // Rendering behavior for empty and populated states.
  describe('ConfigVar Rendering', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      variableIndex = 0
      toastErrorSpy.mockClear()
    })

    it('should show empty state when no variables exist', () => {
      renderConfigVar({ promptVariables: [] })

      expect(screen.getByText('appDebug.notSetVar:{"input":"{{input}}"}'))!.toBeInTheDocument()
    })

    it('should render variable items and allow reordering via sortable list', () => {
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const firstVar = createPromptVariable({ key: 'first', name: 'First' })
      const secondVar = createPromptVariable({ key: 'second', name: 'Second' })

      renderConfigVar({
        promptVariables: [firstVar, secondVar],
        onPromptVariablesChange,
      })

      expect(screen.getByText('first'))!.toBeInTheDocument()
      expect(screen.getByText('second'))!.toBeInTheDocument()

      act(() => {
        latestSortableProps?.setList([
          { id: 'second', variable: secondVar },
          { id: 'first', variable: firstVar },
        ])
      })

      expect(onPromptVariablesChange).toHaveBeenCalledWith([secondVar, firstVar])
    })

    it('commits variable keyboard sorting only after confirmation', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const first = createPromptVariable({ key: 'first', name: 'First' })
      const second = createPromptVariable({ key: 'second', name: 'Second' })
      renderConfigVar({ promptVariables: [first, second], onPromptVariablesChange })
      const handle = screen.getAllByRole('button', { name: /sort.handle/ })[0]!
      handle.focus()
      await user.keyboard('{Enter}{ArrowDown}')
      expect(handle).toHaveFocus()
      expect(onPromptVariablesChange).not.toHaveBeenCalled()
      await user.keyboard('{Enter}')
      expect(onPromptVariablesChange).toHaveBeenCalledExactlyOnceWith([second, first])
    })

    it('does not expose keyboard sorting in readonly mode', () => {
      renderConfigVar({
        readonly: true,
        promptVariables: [createPromptVariable(), createPromptVariable()],
      })
      expect(screen.queryByRole('button', { name: /sort.handle/ })).not.toBeInTheDocument()
    })

    it('should ignore sortable updates when the variable order is unchanged', () => {
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const firstVar = createPromptVariable({ key: 'first', name: 'First' })
      const secondVar = createPromptVariable({ key: 'second', name: 'Second' })

      renderConfigVar({
        promptVariables: [firstVar, secondVar],
        onPromptVariablesChange,
      })

      act(() => {
        latestSortableProps?.setList([
          { id: 'first', variable: firstVar },
          { id: 'second', variable: secondVar },
        ])
      })

      expect(onPromptVariablesChange).not.toHaveBeenCalled()
    })
  })

  // Variable creation flows using the add menu.
  describe('ConfigVar Add Variable', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      variableIndex = 0
      toastErrorSpy.mockClear()
    })

    it('should add a text variable when selecting the string option', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      renderConfigVar({ promptVariables: [], onPromptVariablesChange })

      await user.click(screen.getByText('common.operation.add'))
      await user.click(await screen.findByText('appDebug.variableConfig.string'))

      expect(onPromptVariablesChange).toHaveBeenCalledTimes(1)
      const [nextVariables] = onPromptVariablesChange.mock.calls[0]!
      expect(nextVariables).toHaveLength(1)
      expect(nextVariables[0]!.type).toBe('string')
    })

    it('should restore previous variables when cancelling api variable with existing items', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const existingVar = createPromptVariable({ key: 'existing', name: 'Existing' })

      renderConfigVar({ promptVariables: [existingVar], onPromptVariablesChange })

      await user.click(screen.getByText('common.operation.add'))
      await user.click(await screen.findByText('appDebug.variableConfig.apiBasedVar'))

      const modalState = setShowExternalDataToolModal.mock.calls[0]![0]
      act(() => {
        modalState.onCancelCallback?.()
      })

      expect(onPromptVariablesChange).toHaveBeenCalledTimes(2)
      const [addedVariables] = onPromptVariablesChange.mock.calls[0]!
      expect(addedVariables).toHaveLength(2)
      expect(addedVariables[0]).toBe(existingVar)
      expect(addedVariables[1]!.type).toBe('api')
      expect(onPromptVariablesChange).toHaveBeenLastCalledWith([existingVar])
    })
  })

  // Editing flows for variables through the modal.
  describe('ConfigVar Edit Variable', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      variableIndex = 0
      toastErrorSpy.mockClear()
    })

    it('should save updates when editing a basic variable', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const variable = createPromptVariable({ key: 'name', name: 'Name' })

      renderConfigVar({
        promptVariables: [variable],
        onPromptVariablesChange,
      })

      await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)

      const editDialog = await screen.findByRole('dialog')
      const label = within(editDialog).getByRole('textbox', {
        name: 'appDebug.variableConfig.labelName',
      })
      await user.clear(label)
      await user.type(label, 'Updated Name')
      const saveButton = within(editDialog).getByRole('button', { name: 'common.operation.save' })
      await user.click(saveButton)

      await waitFor(() => {
        expect(onPromptVariablesChange).toHaveBeenCalledWith([
          expect.objectContaining({ key: 'name', name: 'Updated Name' }),
        ])
      })
    })

    it('should show error when variable key is duplicated', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const firstVar = createPromptVariable({ key: 'first', name: 'First' })
      const secondVar = createPromptVariable({ key: 'second', name: 'Second' })

      renderConfigVar({
        promptVariables: [firstVar, secondVar],
        onPromptVariablesChange,
      })

      await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)

      const input = screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })
      await user.clear(input)
      await user.type(input, 'second')

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(toastErrorSpy).toHaveBeenCalled()
      expect(onPromptVariablesChange).not.toHaveBeenCalled()
    })

    it('should show error when variable label is duplicated', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const firstVar = createPromptVariable({ key: 'first', name: 'First' })
      const secondVar = createPromptVariable({ key: 'second', name: 'Second' })

      renderConfigVar({
        promptVariables: [firstVar, secondVar],
        onPromptVariablesChange,
      })

      await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)

      const input = screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
      await user.clear(input)
      await user.type(input, 'Second')

      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(toastErrorSpy).toHaveBeenCalled()
      expect(onPromptVariablesChange).not.toHaveBeenCalled()
    })
  })

  // Removal behavior including confirm modal branch.
  describe('ConfigVar Remove Variable', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      variableIndex = 0
      toastErrorSpy.mockClear()
    })

    it('should remove variable directly when context confirmation is not required', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const variable = createPromptVariable({ key: 'name', name: 'Name' })

      renderConfigVar({
        promptVariables: [variable],
        onPromptVariablesChange,
      })

      const removeBtn = screen.getByRole('button', { name: 'common.operation.delete' })
      await user.click(removeBtn)

      expect(onPromptVariablesChange).toHaveBeenCalledWith([])
    })

    it('should require confirmation when removing context variable with datasets in completion mode', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const variable = createPromptVariable({
        key: 'context',
        name: 'Context',
        is_context_var: true,
      })

      renderConfigVar(
        {
          promptVariables: [variable],
          onPromptVariablesChange,
        },
        {
          mode: 'completion' as const,
          dataSets: [createDatasetFixture({ id: 'dataset-1' })],
        },
      )

      const deleteBtn = screen.getByRole('button', { name: 'common.operation.delete' })
      await user.click(deleteBtn)
      expect(onPromptVariablesChange).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(onPromptVariablesChange).toHaveBeenCalledWith([])
    })
  })

  // Event subscription support for external data tools.
  describe('ConfigVar External Data Tool Events', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      variableIndex = 0
      toastErrorSpy.mockClear()
    })

    it('should append external data tool variables from event emitter', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      renderConfigVar({
        promptVariables: [],
        onPromptVariablesChange,
      })

      await user.click(screen.getByRole('button', { name: 'Install external data tool' }))

      expect(onPromptVariablesChange).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'api_var',
          name: 'API Var',
          required: true,
          type: 'api',
        }),
      ])
    })

    it('should update an api variable with the modal save callback', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const apiVar = createPromptVariable({
        key: 'api_var',
        name: 'API Var',
        type: 'api',
      })

      renderConfigVar({
        promptVariables: [apiVar],
        onPromptVariablesChange,
      })

      await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)

      const modalState = setShowExternalDataToolModal.mock.calls.at(-1)?.[0]

      act(() => {
        modalState.onSaveCallback?.({
          variable: 'next_api_var',
          label: 'Next API Var',
          enabled: true,
          type: 'api',
          config: { endpoint: '/search' },
          icon: 'tool-icon',
          icon_background: '#fff',
        })
      })

      expect(onPromptVariablesChange).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'next_api_var',
          name: 'Next API Var',
          type: 'api',
          icon: 'tool-icon',
        }),
      ])
    })

    it('should ignore empty external tool saves and reject duplicate variable names during validation', async () => {
      const user = userEvent.setup()
      const onPromptVariablesChange =
        vi.fn<NonNullable<React.ComponentProps<typeof ConfigVar>['onPromptVariablesChange']>>()
      const firstVar = createPromptVariable({
        key: 'api_var',
        name: 'API Var',
        type: 'api',
      })
      const secondVar = createPromptVariable({
        key: 'existing_var',
        name: 'Existing Var',
        type: 'string',
      })

      renderConfigVar({
        promptVariables: [firstVar, secondVar],
        onPromptVariablesChange,
      })

      await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)

      const modalState = setShowExternalDataToolModal.mock.calls.at(-1)?.[0]

      act(() => {
        modalState.onSaveCallback?.(undefined)
      })

      expect(onPromptVariablesChange).not.toHaveBeenCalled()

      const isValid = modalState.onValidateBeforeSaveCallback?.({
        variable: 'existing_var',
        label: 'Duplicated',
        enabled: true,
        type: 'api',
        config: {},
      })

      expect(isValid).toBe(false)
      expect(toastErrorSpy).toHaveBeenCalled()
    })
  })
})
