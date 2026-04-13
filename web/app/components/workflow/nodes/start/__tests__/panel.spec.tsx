import type { StartNodeType } from '../types'
import type { InputVar } from '@/app/components/workflow/types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import Panel from '../panel'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockConfigVarModal = vi.hoisted(() => vi.fn())
const mockRemoveEffectVarConfirm = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('@/app/components/app/configuration/config-var/config-modal', () => ({
  __esModule: true,
  default: (props: {
    isShow: boolean
    onClose: () => void
    onConfirm: (payload: InputVar) => void
  }) => {
    mockConfigVarModal(props)
    return props.isShow
      ? (
          <button
            type="button"
            onClick={() => props.onConfirm({
              label: 'Locale',
              variable: 'locale',
              type: InputVarType.textInput,
              required: false,
            })}
          >
            confirm-add-var
          </button>
        )
      : null
  },
}))

vi.mock('../../_base/components/remove-effect-var-confirm', () => ({
  __esModule: true,
  default: (props: {
    isShow: boolean
    onConfirm: () => void
    onCancel: () => void
  }) => {
    mockRemoveEffectVarConfirm(props)
    return props.isShow ? <div>remove-confirm</div> : null
  },
}))

const createData = (overrides: Partial<StartNodeType> = {}): StartNodeType => ({
  title: 'Start',
  desc: '',
  type: BlockEnum.Start,
  variables: [],
  ...overrides,
})

describe('StartPanel', () => {
  const showAddVarModal = vi.fn()
  const hideAddVarModal = vi.fn()
  const handleAddVariable = vi.fn()
  const handleVarListChange = vi.fn()
  const hideRemoveVarConfirm = vi.fn()
  const onRemoveVarConfirm = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    handleAddVariable.mockReturnValue(true)
    mockUseConfig.mockReturnValue({
      readOnly: false,
      isChatMode: true,
      inputs: createData(),
      isShowAddVarModal: false,
      showAddVarModal,
      handleAddVariable,
      hideAddVarModal,
      handleVarListChange,
      isShowRemoveVarConfirm: false,
      hideRemoveVarConfirm,
      onRemoveVarConfirm,
    })
  })

  it('should show chat-only system variables and open the add-variable modal when writable', () => {
    render(<Panel id="start-node" data={createData()} panelProps={{} as PanelProps} />)

    expect(screen.getByText('userinput.query')).toBeInTheDocument()
    expect(screen.getByText('userinput.files')).toBeInTheDocument()
    expect(screen.queryByText('LEGACY')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('add-button'))

    expect(showAddVarModal).toHaveBeenCalledTimes(1)
  })

  it('should render the add modal and hide it after a successful confirm', () => {
    mockUseConfig.mockReturnValue({
      readOnly: false,
      isChatMode: false,
      inputs: createData(),
      isShowAddVarModal: true,
      showAddVarModal,
      handleAddVariable,
      hideAddVarModal,
      handleVarListChange,
      isShowRemoveVarConfirm: true,
      hideRemoveVarConfirm,
      onRemoveVarConfirm,
    })

    render(<Panel id="start-node" data={createData()} panelProps={{} as PanelProps} />)

    expect(screen.queryByText('userinput.query')).not.toBeInTheDocument()
    expect(screen.getByText('LEGACY')).toBeInTheDocument()
    expect(screen.getByText('remove-confirm')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'confirm-add-var' }))

    expect(handleAddVariable).toHaveBeenCalledWith(expect.objectContaining({
      variable: 'locale',
    }))
    expect(hideAddVarModal).toHaveBeenCalledTimes(1)
  })

  it('should keep the add modal open when validation fails and pass existing variable keys to the modal', () => {
    handleAddVariable.mockReturnValue(false)
    mockUseConfig.mockReturnValue({
      readOnly: false,
      isChatMode: false,
      inputs: createData({
        variables: [{
          label: 'Locale',
          variable: 'locale',
          type: InputVarType.textInput,
          required: false,
        }],
      }),
      isShowAddVarModal: true,
      showAddVarModal,
      handleAddVariable,
      hideAddVarModal,
      handleVarListChange,
      isShowRemoveVarConfirm: false,
      hideRemoveVarConfirm,
      onRemoveVarConfirm,
    })

    render(<Panel id="start-node" data={createData()} panelProps={{} as PanelProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'confirm-add-var' }))

    expect(mockConfigVarModal).toHaveBeenCalledWith(expect.objectContaining({
      varKeys: ['locale'],
    }))
    expect(hideAddVarModal).not.toHaveBeenCalled()
  })
})
