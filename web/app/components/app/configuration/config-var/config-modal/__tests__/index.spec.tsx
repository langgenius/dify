import type { InputVar } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { InputVarType } from '@/app/components/workflow/types'
import DebugConfigurationContext from '@/context/debug-configuration'
import { AppModeEnum } from '@/types/app'
import ConfigModal from '../index'

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

type DebugConfigValue = React.ComponentProps<typeof DebugConfigurationContext.Provider>['value']

const createDebugConfigValue = (overrides: Partial<DebugConfigValue> = {}): DebugConfigValue => ({
  mode: AppModeEnum.CHAT,
  modelConfig: {
    model_id: 'test-model',
  },
  ...overrides,
} as DebugConfigValue)

const createAppDetail = (mode: AppModeEnum) => ({
  mode,
}) as NonNullable<ReturnType<typeof useAppStore.getState>['appDetail']>

const createInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  type: InputVarType.textInput,
  label: '',
  variable: '',
  required: false,
  hide: false,
  default: '',
  ...overrides,
})

const renderConfigModal = (
  props: Partial<React.ComponentProps<typeof ConfigModal>> = {},
  debugOverrides: Partial<DebugConfigValue> = {},
) => {
  const defaultProps: React.ComponentProps<typeof ConfigModal> = {
    isCreate: true,
    isShow: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    payload: createInputVar(),
    supportFile: false,
  }

  const mergedProps = {
    ...defaultProps,
    ...props,
  }

  return render(
    <DebugConfigurationContext.Provider value={createDebugConfigValue(debugOverrides)}>
      <ConfigModal {...mergedProps} />
    </DebugConfigurationContext.Provider>,
  )
}

describe('ConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ appDetail: createAppDetail(AppModeEnum.CHAT) })
  })

  // Covers the main text-input save path through the rendered modal.
  describe('Save flows', () => {
    it('should auto-fill the label and submit the edited payload for text inputs', () => {
      const onConfirm = vi.fn()
      renderConfigModal({ onConfirm })

      const textboxes = screen.getAllByRole('textbox')
      fireEvent.change(textboxes[0], { target: { value: 'user name' } })
      fireEvent.blur(textboxes[0])
      fireEvent.change(textboxes[2], { target: { value: 'hello world' } })

      expect(textboxes[1]).toHaveValue('user_name')

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        variable: 'user_name',
        label: 'user_name',
        default: 'hello world',
      }), {
        type: 'changeVarName',
        payload: {
          beforeKey: '',
          afterKey: 'user_name',
        },
      })
    })

    it('should block save and show an error when label is missing', () => {
      const onConfirm = vi.fn()
      renderConfigModal({
        onConfirm,
        payload: createInputVar({
          label: '',
          variable: 'name',
        }),
      })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onConfirm).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('appDebug.variableConfig.errorMsg.labelNameRequired')
    })
  })

  // Covers conditional sections for non-text variable types.
  describe('Conditional rendering', () => {
    it('should render select-specific sections when editing a select variable', () => {
      renderConfigModal({
        payload: createInputVar({
          type: InputVarType.select,
          label: 'Category',
          variable: 'category',
          options: ['A', 'B'],
          default: 'A',
        }),
      })

      expect(screen.getByText('appDebug.variableConfig.options')).toBeInTheDocument()
      expect(screen.getAllByText('A').length).toBeGreaterThan(0)
    })
  })
})
