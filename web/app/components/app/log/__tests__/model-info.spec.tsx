import { fireEvent, render, screen } from '@testing-library/react'
import ModelInfo from '../model-info'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    currentModel: {
      model: 'gpt-4',
      model_display_name: 'GPT-4',
    },
    currentProvider: {
      provider: 'openai',
      label: 'OpenAI',
    },
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ modelName }: { provider: unknown, modelName: string }) => (
    <div data-testid="model-icon" data-model-name={modelName}>ModelIcon</div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-name', () => ({
  default: ({ modelItem, showMode }: { modelItem: { model: string }, showMode: boolean }) => (
    <div data-testid="model-name" data-show-mode={showMode ? 'true' : 'false'}>
      {modelItem?.model}
    </div>
  ),
}))

vi.mock('@/app/components/base/ui/popover', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext<{ open: boolean, onOpenChange?: (open: boolean) => void } | null>(null)

  return {
    Popover: ({ children, open, onOpenChange }: { children: React.ReactNode, open: boolean, onOpenChange?: (open: boolean) => void }) => (
      <PopoverContext.Provider value={{ open, onOpenChange }}>
        <div data-testid="popover-root" data-open={open ? 'true' : 'false'}>
          {children}
        </div>
      </PopoverContext.Provider>
    ),
    PopoverTrigger: ({ children, render }: { children?: React.ReactNode, render?: React.ReactNode }) => {
      const context = React.useContext(PopoverContext)
      const content = render ?? children
      const handleClick = () => {
        context?.onOpenChange?.(!context.open)
      }

      if (React.isValidElement(content)) {
        const element = content as React.ReactElement<{ onClick?: () => void }>
        return React.cloneElement(element, { onClick: handleClick })
      }

      return <button type="button" data-testid="popover-trigger" onClick={handleClick}>{content}</button>
    },
    PopoverContent: ({ children }: { children: React.ReactNode }) => {
      const context = React.useContext(PopoverContext)
      if (!context?.open)
        return null

      return <div data-testid="popover-content">{children}</div>
    },
  }
})

describe('ModelInfo', () => {
  const defaultModel = {
    name: 'gpt-4',
    provider: 'openai',
    completion_params: {
      temperature: 0.7,
      top_p: 0.9,
      presence_penalty: 0.1,
      max_tokens: 2048,
      stop: ['END'],
    },
  }

  describe('Rendering', () => {
    it('should render model icon', () => {
      render(<ModelInfo model={defaultModel} />)

      expect(screen.getByTestId('model-icon')).toBeInTheDocument()
    })

    it('should render model name', () => {
      render(<ModelInfo model={defaultModel} />)

      expect(screen.getByTestId('model-name')).toBeInTheDocument()
      expect(screen.getByTestId('model-name')).toHaveTextContent('gpt-4')
    })

    it('should render info icon button', () => {
      const { container } = render(<ModelInfo model={defaultModel} />)

      // The info button should contain an SVG icon
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('should show model name with showMode prop', () => {
      render(<ModelInfo model={defaultModel} />)

      expect(screen.getByTestId('model-name')).toHaveAttribute('data-show-mode', 'true')
    })
  })

  describe('Info Panel Toggle', () => {
    it('should be closed by default', () => {
      render(<ModelInfo model={defaultModel} />)

      expect(screen.getByTestId('popover-root')).toHaveAttribute('data-open', 'false')
      expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
    })

    it('should open when info button is clicked', () => {
      render(<ModelInfo model={defaultModel} />)

      const trigger = screen.getByRole('button')
      fireEvent.click(trigger)

      expect(screen.getByTestId('popover-root')).toHaveAttribute('data-open', 'true')
      expect(screen.getByTestId('popover-content')).toBeInTheDocument()
    })

    it('should close when info button is clicked again', () => {
      render(<ModelInfo model={defaultModel} />)

      const trigger = screen.getByRole('button')

      // Open
      fireEvent.click(trigger)
      expect(screen.getByTestId('popover-root')).toHaveAttribute('data-open', 'true')

      // Close
      fireEvent.click(trigger)
      expect(screen.getByTestId('popover-root')).toHaveAttribute('data-open', 'false')
    })
  })

  describe('Model Parameters Display', () => {
    it('should render model params header', () => {
      render(<ModelInfo model={defaultModel} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('detail.modelParams')).toBeInTheDocument()
    })

    it('should render temperature parameter', () => {
      render(<ModelInfo model={defaultModel} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('Temperature')).toBeInTheDocument()
      expect(screen.getByText('0.7')).toBeInTheDocument()
    })

    it('should render top_p parameter', () => {
      render(<ModelInfo model={defaultModel} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('Top P')).toBeInTheDocument()
      expect(screen.getByText('0.9')).toBeInTheDocument()
    })

    it('should render presence_penalty parameter', () => {
      render(<ModelInfo model={defaultModel} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('Presence Penalty')).toBeInTheDocument()
      expect(screen.getByText('0.1')).toBeInTheDocument()
    })

    it('should render max_tokens parameter', () => {
      render(<ModelInfo model={defaultModel} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('Max Token')).toBeInTheDocument()
      expect(screen.getByText('2048')).toBeInTheDocument()
    })

    it('should render stop parameter as comma-separated values', () => {
      render(<ModelInfo model={defaultModel} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('Stop')).toBeInTheDocument()
      expect(screen.getByText('END')).toBeInTheDocument()
    })
  })

  describe('Missing Parameters', () => {
    it('should show dash for missing parameters', () => {
      const modelWithNoParams = {
        name: 'gpt-4',
        provider: 'openai',
        completion_params: {},
      }

      render(<ModelInfo model={modelWithNoParams} />)
      fireEvent.click(screen.getByRole('button'))

      const dashes = screen.getAllByText('-')
      expect(dashes.length).toBeGreaterThan(0)
    })

    it('should show dash for non-array stop values', () => {
      const modelWithInvalidStop = {
        name: 'gpt-4',
        provider: 'openai',
        completion_params: {
          stop: 'not-an-array',
        },
      }

      render(<ModelInfo model={modelWithInvalidStop} />)
      fireEvent.click(screen.getByRole('button'))

      const stopValues = screen.getAllByText('-')
      expect(stopValues.length).toBeGreaterThan(0)
    })

    it('should join array stop values with comma', () => {
      const modelWithMultipleStops = {
        name: 'gpt-4',
        provider: 'openai',
        completion_params: {
          stop: ['END', 'STOP', 'DONE'],
        },
      }

      render(<ModelInfo model={modelWithMultipleStops} />)
      fireEvent.click(screen.getByRole('button'))

      expect(screen.getByText('END,STOP,DONE')).toBeInTheDocument()
    })
  })

  describe('Model without completion_params', () => {
    it('should handle undefined completion_params', () => {
      const modelWithNoCompletionParams = {
        name: 'gpt-4',
        provider: 'openai',
      }

      render(<ModelInfo model={modelWithNoCompletionParams} />)

      expect(screen.getByTestId('model-icon')).toBeInTheDocument()
    })
  })
})
