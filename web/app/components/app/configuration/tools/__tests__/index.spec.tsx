import type { ExternalDataTool } from '@/models/common'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import Tools from '../index'

const mockCopy = vi.fn()
const mockSetExternalDataToolsConfig = vi.fn()
const mockSetShowExternalDataToolModal = vi.fn()

let mockConfigContext: {
  externalDataToolsConfig: ExternalDataTool[]
  modelConfig: {
    configs?: {
      prompt_variables?: Array<{ key: string }>
    }
  }
  setExternalDataToolsConfig: typeof mockSetExternalDataToolsConfig
}

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('use-context-selector', async () => {
  const actual = await vi.importActual<typeof import('use-context-selector')>('use-context-selector')
  return {
    ...actual,
    useContext: () => mockConfigContext,
  }
})

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalDataToolModal: mockSetShowExternalDataToolModal,
  }),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ icon }: { icon?: string }) => <div data-testid="app-icon">{icon || 'icon'}</div>,
}))

vi.mock('@/app/components/base/switch', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: boolean
    onChange: (value: boolean) => void
  }) => (
    <button onClick={() => onChange(!value)}>
      {value ? 'switch-on' : 'switch-off'}
    </button>
  ),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/app/components/base/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    render,
  }: {
    render: React.ReactNode
  }) => <>{render}</>,
}))

vi.mock('@remixicon/react', () => ({
  RiAddLine: () => <span>add-icon</span>,
  RiArrowDownSLine: () => <span>arrow-icon</span>,
  RiDeleteBinLine: () => <span>delete-icon</span>,
}))

vi.mock('@/app/components/base/icons/src/vender/line/general', () => ({
  Settings01: () => <span>settings-icon</span>,
}))

vi.mock('@/app/components/base/icons/src/vender/solid/general', () => ({
  Tool03: () => <span>tool-icon</span>,
}))

const createTool = (overrides: Partial<ExternalDataTool> = {}): ExternalDataTool => ({
  config: {
    api_based_extension_id: 'extension-1',
  },
  enabled: false,
  icon: '🤖',
  icon_background: '#fff',
  label: 'External tool',
  type: 'api',
  variable: 'tool_var',
  ...overrides,
})

describe('configuration/tools/index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigContext = {
      externalDataToolsConfig: [],
      modelConfig: {
        configs: {
          prompt_variables: [],
        },
      },
      setExternalDataToolsConfig: mockSetExternalDataToolsConfig,
    }
  })

  it('should open the add-tool modal and reject prompt-variable conflicts before save', async () => {
    const user = userEvent.setup()
    mockConfigContext.modelConfig.configs!.prompt_variables = [{ key: 'prompt_var' }]

    render(<Tools />)

    await user.click(screen.getByText('common.operation.add'))

    const modalPayload = mockSetShowExternalDataToolModal.mock.calls[0][0]

    expect(modalPayload.payload).toEqual({})
    expect(modalPayload.onValidateBeforeSaveCallback(createTool({ variable: 'prompt_var' }))).toBe(false)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('prompt_var'))
  })

  it('should save, copy, edit, delete, and toggle configured tools', async () => {
    const user = userEvent.setup()
    const existingTool = createTool()
    mockConfigContext.externalDataToolsConfig = [existingTool]

    const { container } = render(<Tools />)

    await user.click(screen.getByText('common.operation.add'))

    const modalPayload = mockSetShowExternalDataToolModal.mock.calls[0][0]
    modalPayload.onSaveCallback(createTool({ label: 'New tool', variable: 'new_var' }))

    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([
      existingTool,
      createTool({ label: 'New tool', variable: 'new_var' }),
    ])

    await user.click(screen.getByText('tool_var'))

    expect(mockCopy).toHaveBeenCalledWith('tool_var')
    expect(screen.getByText('appApi.copied')).toBeInTheDocument()

    await user.click(screen.getByText('settings-icon'))

    const editPayload = mockSetShowExternalDataToolModal.mock.calls[1][0]
    expect(editPayload.payload).toEqual(existingTool)
    expect(editPayload.onValidateBeforeSaveCallback(createTool({ variable: 'new_var' }))).toBe(true)

    await user.click(screen.getByText('delete-icon'))

    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([])

    await user.click(screen.getByText('switch-off'))

    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([
      createTool({ enabled: true }),
    ])

    await user.click(container.querySelector('.group') as HTMLElement)

    expect(screen.queryByText('External tool')).not.toBeInTheDocument()
    expect(screen.getByText(/appDebug\.feature\.tools\.toolsInUse/)).toBeInTheDocument()
  })
})
