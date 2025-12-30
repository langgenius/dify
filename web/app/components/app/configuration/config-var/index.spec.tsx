import type { ReactNode } from 'react'
import type { IConfigVarProps } from './index'
import type { ExternalDataTool } from '@/models/common'
import type { PromptVariable } from '@/models/debug'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import DebugConfigurationContext from '@/context/debug-configuration'
import { AppModeEnum } from '@/types/app'

import ConfigVar, { ADD_EXTERNAL_DATA_TOOL } from './index'

const notifySpy = vi.spyOn(Toast, 'notify').mockImplementation(vi.fn())

const setShowExternalDataToolModal = vi.fn()

type SubscriptionEvent = {
  type: string
  payload: ExternalDataTool
}

let subscriptionCallback: ((event: SubscriptionEvent) => void) | null = null

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: (callback: (event: SubscriptionEvent) => void) => {
        subscriptionCallback = callback
      },
    },
  }),
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

type DebugConfigurationState = React.ComponentProps<typeof DebugConfigurationContext.Provider>['value']

const defaultDebugConfigValue = {
  mode: AppModeEnum.CHAT,
  dataSets: [],
  modelConfig: {
    model_id: 'test-model',
  },
} as unknown as DebugConfigurationState

const createDebugConfigValue = (overrides: Partial<DebugConfigurationState> = {}): DebugConfigurationState => ({
  ...defaultDebugConfigValue,
  ...overrides,
} as unknown as DebugConfigurationState)

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

const renderConfigVar = (props: Partial<IConfigVarProps> = {}, debugOverrides: Partial<DebugConfigurationState> = {}) => {
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
    <DebugConfigurationContext.Provider value={createDebugConfigValue(debugOverrides)}>
      <ConfigVar {...mergedProps} />
    </DebugConfigurationContext.Provider>,
  )
}

describe('ConfigVar', () => {
  // Rendering behavior for empty and populated states.
  describe('ConfigVar Rendering', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      subscriptionCallback = null
      variableIndex = 0
      notifySpy.mockClear()
    })

    it('should show empty state when no variables exist', () => {
      renderConfigVar({ promptVariables: [] })

      expect(screen.getByText('appDebug.notSetVar')).toBeInTheDocument()
    })

    it('should render variable items and allow reordering via sortable list', () => {
      const onPromptVariablesChange = vi.fn()
      const firstVar = createPromptVariable({ key: 'first', name: 'First' })
      const secondVar = createPromptVariable({ key: 'second', name: 'Second' })

      renderConfigVar({
        promptVariables: [firstVar, secondVar],
        onPromptVariablesChange,
      })

      expect(screen.getByText('first')).toBeInTheDocument()
      expect(screen.getByText('second')).toBeInTheDocument()

      act(() => {
        latestSortableProps?.setList([
          { id: 'second', variable: secondVar },
          { id: 'first', variable: firstVar },
        ])
      })

      expect(onPromptVariablesChange).toHaveBeenCalledWith([secondVar, firstVar])
    })
  })

  // Variable creation flows using the add menu.
  describe('ConfigVar Add Variable', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      subscriptionCallback = null
      variableIndex = 0
      notifySpy.mockClear()
    })

    it('should add a text variable when selecting the string option', async () => {
      const onPromptVariablesChange = vi.fn()
      renderConfigVar({ promptVariables: [], onPromptVariablesChange })

      fireEvent.click(screen.getByText('common.operation.add'))
      fireEvent.click(await screen.findByText('appDebug.variableConfig.string'))

      expect(onPromptVariablesChange).toHaveBeenCalledTimes(1)
      const [nextVariables] = onPromptVariablesChange.mock.calls[0]
      expect(nextVariables).toHaveLength(1)
      expect(nextVariables[0].type).toBe('string')
    })

    it('should open the external data tool modal when adding an api variable', async () => {
      const onPromptVariablesChange = vi.fn()
      renderConfigVar({ promptVariables: [], onPromptVariablesChange })

      fireEvent.click(screen.getByText('common.operation.add'))
      fireEvent.click(await screen.findByText('appDebug.variableConfig.apiBasedVar'))

      expect(onPromptVariablesChange).toHaveBeenCalledTimes(1)
      expect(setShowExternalDataToolModal).toHaveBeenCalledTimes(1)

      const modalState = setShowExternalDataToolModal.mock.calls[0][0]
      expect(modalState.payload.type).toBe('api')

      act(() => {
        modalState.onCancelCallback?.()
      })

      expect(onPromptVariablesChange).toHaveBeenLastCalledWith([])
    })

    it('should restore previous variables when cancelling api variable with existing items', async () => {
      const onPromptVariablesChange = vi.fn()
      const existingVar = createPromptVariable({ key: 'existing', name: 'Existing' })

      renderConfigVar({ promptVariables: [existingVar], onPromptVariablesChange })

      fireEvent.click(screen.getByText('common.operation.add'))
      fireEvent.click(await screen.findByText('appDebug.variableConfig.apiBasedVar'))

      const modalState = setShowExternalDataToolModal.mock.calls[0][0]
      act(() => {
        modalState.onCancelCallback?.()
      })

      expect(onPromptVariablesChange).toHaveBeenCalledTimes(2)
      const [addedVariables] = onPromptVariablesChange.mock.calls[0]
      expect(addedVariables).toHaveLength(2)
      expect(addedVariables[0]).toBe(existingVar)
      expect(addedVariables[1].type).toBe('api')
      expect(onPromptVariablesChange).toHaveBeenLastCalledWith([existingVar])
    })
  })

  // Editing flows for variables through the modal.
  describe('ConfigVar Edit Variable', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      subscriptionCallback = null
      variableIndex = 0
      notifySpy.mockClear()
    })

    it('should save updates when editing a basic variable', async () => {
      const onPromptVariablesChange = vi.fn()
      const variable = createPromptVariable({ key: 'name', name: 'Name' })

      renderConfigVar({
        promptVariables: [variable],
        onPromptVariablesChange,
      })

      const item = screen.getByTitle('name · Name')
      const itemContainer = item.closest('div.group')
      expect(itemContainer).not.toBeNull()
      const actionButtons = itemContainer!.querySelectorAll('div.h-6.w-6')
      expect(actionButtons).toHaveLength(2)
      fireEvent.click(actionButtons[0])

      const saveButton = await screen.findByRole('button', { name: 'common.operation.save' })
      fireEvent.click(saveButton)

      expect(onPromptVariablesChange).toHaveBeenCalledTimes(1)
    })

    it('should show error when variable key is duplicated', async () => {
      const onPromptVariablesChange = vi.fn()
      const firstVar = createPromptVariable({ key: 'first', name: 'First' })
      const secondVar = createPromptVariable({ key: 'second', name: 'Second' })

      renderConfigVar({
        promptVariables: [firstVar, secondVar],
        onPromptVariablesChange,
      })

      const item = screen.getByTitle('first · First')
      const itemContainer = item.closest('div.group')
      expect(itemContainer).not.toBeNull()
      const actionButtons = itemContainer!.querySelectorAll('div.h-6.w-6')
      expect(actionButtons).toHaveLength(2)
      fireEvent.click(actionButtons[0])

      const inputs = await screen.findAllByPlaceholderText('appDebug.variableConfig.inputPlaceholder')
      fireEvent.change(inputs[0], { target: { value: 'second' } })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(Toast.notify).toHaveBeenCalled()
      expect(onPromptVariablesChange).not.toHaveBeenCalled()
    })

    it('should show error when variable label is duplicated', async () => {
      const onPromptVariablesChange = vi.fn()
      const firstVar = createPromptVariable({ key: 'first', name: 'First' })
      const secondVar = createPromptVariable({ key: 'second', name: 'Second' })

      renderConfigVar({
        promptVariables: [firstVar, secondVar],
        onPromptVariablesChange,
      })

      const item = screen.getByTitle('first · First')
      const itemContainer = item.closest('div.group')
      expect(itemContainer).not.toBeNull()
      const actionButtons = itemContainer!.querySelectorAll('div.h-6.w-6')
      expect(actionButtons).toHaveLength(2)
      fireEvent.click(actionButtons[0])

      const inputs = await screen.findAllByPlaceholderText('appDebug.variableConfig.inputPlaceholder')
      fireEvent.change(inputs[1], { target: { value: 'Second' } })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(Toast.notify).toHaveBeenCalled()
      expect(onPromptVariablesChange).not.toHaveBeenCalled()
    })
  })

  // Removal behavior including confirm modal branch.
  describe('ConfigVar Remove Variable', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      subscriptionCallback = null
      variableIndex = 0
      notifySpy.mockClear()
    })

    it('should remove variable directly when context confirmation is not required', () => {
      const onPromptVariablesChange = vi.fn()
      const variable = createPromptVariable({ key: 'name', name: 'Name' })

      renderConfigVar({
        promptVariables: [variable],
        onPromptVariablesChange,
      })

      const removeBtn = screen.getByTestId('var-item-delete-btn')
      fireEvent.click(removeBtn)

      expect(onPromptVariablesChange).toHaveBeenCalledWith([])
    })

    it('should require confirmation when removing context variable with datasets in completion mode', () => {
      const onPromptVariablesChange = vi.fn()
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
          mode: AppModeEnum.COMPLETION,
          dataSets: [{ id: 'dataset-1' } as DebugConfigurationState['dataSets'][number]],
        },
      )

      const deleteBtn = screen.getByTestId('var-item-delete-btn')
      fireEvent.click(deleteBtn)
      // confirmation modal should show up
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(onPromptVariablesChange).toHaveBeenCalledWith([])
    })
  })

  // Event subscription support for external data tools.
  describe('ConfigVar External Data Tool Events', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      latestSortableProps = null
      subscriptionCallback = null
      variableIndex = 0
      notifySpy.mockClear()
    })

    it('should append external data tool variables from event emitter', () => {
      const onPromptVariablesChange = vi.fn()
      renderConfigVar({
        promptVariables: [],
        onPromptVariablesChange,
      })

      act(() => {
        subscriptionCallback?.({
          type: ADD_EXTERNAL_DATA_TOOL,
          payload: {
            variable: 'api_var',
            label: 'API Var',
            enabled: true,
            type: 'api',
            config: {},
            icon: 'icon',
            icon_background: 'bg',
          },
        })
      })

      expect(onPromptVariablesChange).toHaveBeenCalledWith([
        expect.objectContaining({
          key: 'api_var',
          name: 'API Var',
          required: true,
          type: 'api',
        }),
      ])
    })
  })
})
