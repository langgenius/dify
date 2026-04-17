import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import PublishWithMultipleModel from '../publish-with-multiple-model'

const mockUseProviderContext = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockUseProviderContext(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('../../header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => <span data-testid="model-icon">{modelName}</span>,
}))

vi.mock('@/app/components/base/ui/dropdown-menu', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')
  const OpenContext = ReactModule.createContext<{ open: boolean, setOpen: (nextOpen: boolean) => void } | null>(null)

  const useOpenContext = () => {
    const context = ReactModule.use(OpenContext)
    if (!context)
      throw new Error('DropdownMenu components must be wrapped in DropdownMenu')
    return context
  }

  return {
    DropdownMenu: ({ children, open, onOpenChange }: { children: React.ReactNode, open: boolean, onOpenChange?: (open: boolean) => void }) => (
      <OpenContext.Provider value={{ open, setOpen: onOpenChange ?? vi.fn() }}>
        <div data-testid="portal-root">{children}</div>
      </OpenContext.Provider>
    ),
    DropdownMenuTrigger: ({
      children,
      render,
    }: {
      children: React.ReactNode
      render?: React.ReactElement
    }) => {
      const { open, setOpen } = useOpenContext()

      if (render) {
        return ReactModule.cloneElement(render, {
          onClick: () => setOpen(!open),
        } as Record<string, unknown>, children)
      }

      return <button type="button" onClick={() => setOpen(!open)}>{children}</button>
    },
    DropdownMenuContent: ({ children, popupClassName }: { children: React.ReactNode, popupClassName?: string }) => {
      const context = useOpenContext()
      return context.open ? <div className={popupClassName}>{children}</div> : null
    },
    DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode, onClick?: React.MouseEventHandler<HTMLButtonElement> }) => {
      const { setOpen } = useOpenContext()
      return (
        <button
          type="button"
          onClick={(event) => {
            onClick?.(event)
            setOpen(false)
          }}
        >
          {children}
        </button>
      )
    },
  }
})

describe('PublishWithMultipleModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue({
      textGenerationModelList: [
        {
          provider: 'openai',
          models: [
            {
              model: 'gpt-4o',
              label: {
                en_US: 'GPT-4o',
              },
            },
          ],
        },
      ],
    })
  })

  it('should disable the trigger when no valid model configuration is available', () => {
    render(
      <PublishWithMultipleModel
        multipleModelConfigs={[
          {
            id: 'config-1',
            provider: 'anthropic',
            model: 'claude-3',
            parameters: {},
          },
        ]}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'operation.applyConfig' })).toBeDisabled()
    expect(screen.queryByText('publishAs')).not.toBeInTheDocument()
  })

  it('should open matching model options and call onSelect', () => {
    const handleSelect = vi.fn()
    const modelConfig = {
      id: 'config-1',
      provider: 'openai',
      model: 'gpt-4o',
      parameters: { temperature: 0.7 },
    }

    render(
      <PublishWithMultipleModel
        multipleModelConfigs={[modelConfig]}
        onSelect={handleSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'operation.applyConfig' }))

    expect(screen.getByText('publishAs')).toBeInTheDocument()

    fireEvent.click(screen.getByText('GPT-4o'))

    expect(handleSelect).toHaveBeenCalledWith(expect.objectContaining(modelConfig))
  })
})
