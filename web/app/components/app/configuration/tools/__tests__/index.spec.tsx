import { fireEvent, render, screen } from '@testing-library/react'
import ConfigContext from '@/context/debug-configuration'
import Tools from '../index'

const mockSetShowExternalDataToolModal = vi.fn()
const mockSetExternalDataToolsConfig = vi.fn()
const mockToastError = vi.fn()
const mockCopy = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('copy-to-clipboard', () => ({
  default: (...args: unknown[]) => mockCopy(...args),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalDataToolModal: mockSetShowExternalDataToolModal,
  }),
}))

vi.mock('@/app/components/base/switch', () => ({
  default: ({ onChange, value }: { onChange: (value: boolean) => void, value: boolean }) => (
    <button onClick={() => onChange(!value)}>{value ? 'enabled' : 'disabled'}</button>
  ),
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div>app-icon</div>,
}))

vi.mock('@/app/components/base/icons/src/vender/line/general', () => ({
  Settings01: () => <span>settings-icon</span>,
}))

vi.mock('@remixicon/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@remixicon/react')>()
  return {
    ...actual,
    RiDeleteBinLine: () => <span>delete-tool</span>,
  }
})

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const createContextValue = (overrides: Record<string, unknown> = {}) => ({
  externalDataToolsConfig: [],
  setExternalDataToolsConfig: mockSetExternalDataToolsConfig,
  modelConfig: {
    configs: {
      prompt_variables: [],
    },
  },
  ...overrides,
}) as any

describe('Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open the external data tool modal and validate duplicate variables', () => {
    render(
      <ConfigContext.Provider value={createContextValue({
        modelConfig: {
          configs: {
            prompt_variables: [{ key: 'search_api', name: 'Search API' }],
          },
        },
      })}
      >
        <Tools />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('operation.add'))

    expect(mockSetShowExternalDataToolModal).toHaveBeenCalledTimes(1)
    const modalConfig = mockSetShowExternalDataToolModal.mock.calls[0][0]

    expect(modalConfig.onValidateBeforeSaveCallback({
      variable: 'search_api',
    })).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('varKeyError.keyAlreadyExists')

    modalConfig.onSaveCallback({
      label: 'Search',
      type: 'search',
      variable: 'new_tool',
    })

    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([
      {
        label: 'Search',
        type: 'search',
        variable: 'new_tool',
      },
    ])
  })

  it('should render existing tools and toggle enabled state', () => {
    render(
      <ConfigContext.Provider value={createContextValue({
        externalDataToolsConfig: [
          {
            enabled: false,
            icon: 'icon',
            icon_background: '#fff',
            label: 'Search',
            type: 'search',
            variable: 'search_api',
          },
        ],
      })}
      >
        <Tools />
      </ConfigContext.Provider>,
    )

    expect(screen.getByText('feature.tools.title')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()

    fireEvent.click(screen.getByText('disabled'))

    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([
      {
        enabled: true,
        icon: 'icon',
        icon_background: '#fff',
        label: 'Search',
        type: 'search',
        variable: 'search_api',
      },
    ])

    fireEvent.click(screen.getByText('search_api'))
    expect(mockCopy).toHaveBeenCalledWith('search_api')

    const deleteButton = document.querySelector('.group\\/action') as HTMLElement
    fireEvent.click(deleteButton)
    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([])
  })

  it('should collapse the list and show the tools-in-use summary', () => {
    render(
      <ConfigContext.Provider value={createContextValue({
        externalDataToolsConfig: [
          {
            enabled: false,
            icon: 'icon',
            icon_background: '#fff',
            label: 'Search',
            type: 'search',
            variable: 'search_api',
          },
        ],
      })}
      >
        <Tools />
      </ConfigContext.Provider>,
    )

    const collapsibleTrigger = screen.getByText('feature.tools.title').previousElementSibling as HTMLElement
    fireEvent.click(collapsibleTrigger)

    expect(screen.getByText('feature.tools.toolsInUse')).toBeInTheDocument()
  })

  it('should edit existing tools and reject duplicate variables from other external tools', () => {
    render(
      <ConfigContext.Provider value={createContextValue({
        externalDataToolsConfig: [
          {
            enabled: true,
            icon: 'icon',
            icon_background: '#fff',
            label: 'Search',
            type: 'search',
            variable: 'search_api',
          },
          {
            enabled: true,
            icon: 'icon',
            icon_background: '#000',
            label: 'Calc',
            type: 'calc',
            variable: 'calc_api',
          },
        ],
      })}
      >
        <Tools />
      </ConfigContext.Provider>,
    )

    const settingsButtons = document.querySelectorAll('.mr-1.hidden.h-6.w-6.cursor-pointer.items-center.justify-center.rounded-md.hover\\:bg-black\\/5.group-hover\\:flex')
    fireEvent.click(settingsButtons[0] as HTMLElement)

    const modalConfig = mockSetShowExternalDataToolModal.mock.calls.at(-1)?.[0]
    expect(modalConfig.payload).toEqual(expect.objectContaining({
      variable: 'search_api',
    }))
    expect(modalConfig.onValidateBeforeSaveCallback({
      variable: 'calc_api',
    })).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('varKeyError.keyAlreadyExists')

    modalConfig.onSaveCallback({
      enabled: true,
      icon: 'next-icon',
      icon_background: '#123456',
      label: 'Search Updated',
      type: 'search',
      variable: 'search_updated',
    })

    expect(mockSetExternalDataToolsConfig).toHaveBeenCalledWith([
      {
        enabled: true,
        icon: 'next-icon',
        icon_background: '#123456',
        label: 'Search Updated',
        type: 'search',
        variable: 'search_updated',
      },
      {
        enabled: true,
        icon: 'icon',
        icon_background: '#000',
        label: 'Calc',
        type: 'calc',
        variable: 'calc_api',
      },
    ])
  })

  it('should ignore empty saves from the external tool modal', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Tools />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('operation.add'))

    const modalConfig = mockSetShowExternalDataToolModal.mock.calls[0][0]
    modalConfig.onSaveCallback(undefined)

    expect(mockSetExternalDataToolsConfig).not.toHaveBeenCalled()
  })
})
