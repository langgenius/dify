import type { ModelAndParameter } from '../types'
import type { DebugWithMultipleModelContextType } from './context'
import { render, screen } from '@testing-library/react'
import {
  DebugWithMultipleModelContextProvider,
  useDebugWithMultipleModelContext,
} from './context'

const createModelAndParameter = (overrides: Partial<ModelAndParameter> = {}): ModelAndParameter => ({
  id: 'model-1',
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: {},
  ...overrides,
})

const TestConsumer = () => {
  const context = useDebugWithMultipleModelContext()
  return (
    <div>
      <span data-testid="configs-count">{context.multipleModelConfigs.length}</span>
      <span data-testid="has-check-can-send">{context.checkCanSend ? 'yes' : 'no'}</span>
      <button
        data-testid="call-on-change"
        onClick={() => context.onMultipleModelConfigsChange(true, [])}
      >
        Change
      </button>
      <button
        data-testid="call-on-debug-change"
        onClick={() => context.onDebugWithMultipleModelChange(createModelAndParameter())}
      >
        Debug Change
      </button>
    </div>
  )
}

describe('DebugWithMultipleModelContext', () => {
  describe('useDebugWithMultipleModelContext', () => {
    it('should return default values when used outside provider', () => {
      render(<TestConsumer />)

      expect(screen.getByTestId('configs-count')).toHaveTextContent('0')
      expect(screen.getByTestId('has-check-can-send')).toHaveTextContent('no')
    })

    it('should return default noop functions that do not throw', () => {
      render(<TestConsumer />)

      // These should not throw when called
      expect(() => {
        screen.getByTestId('call-on-change').click()
      }).not.toThrow()

      expect(() => {
        screen.getByTestId('call-on-debug-change').click()
      }).not.toThrow()
    })
  })

  describe('DebugWithMultipleModelContextProvider', () => {
    it('should provide multipleModelConfigs to children', () => {
      const multipleModelConfigs = [
        createModelAndParameter({ id: 'model-1' }),
        createModelAndParameter({ id: 'model-2' }),
      ]

      render(
        <DebugWithMultipleModelContextProvider
          multipleModelConfigs={multipleModelConfigs}
          onMultipleModelConfigsChange={vi.fn()}
          onDebugWithMultipleModelChange={vi.fn()}
        >
          <TestConsumer />
        </DebugWithMultipleModelContextProvider>,
      )

      expect(screen.getByTestId('configs-count')).toHaveTextContent('2')
    })

    it('should provide checkCanSend function to children', () => {
      const checkCanSend = vi.fn(() => true)

      render(
        <DebugWithMultipleModelContextProvider
          multipleModelConfigs={[]}
          onMultipleModelConfigsChange={vi.fn()}
          onDebugWithMultipleModelChange={vi.fn()}
          checkCanSend={checkCanSend}
        >
          <TestConsumer />
        </DebugWithMultipleModelContextProvider>,
      )

      expect(screen.getByTestId('has-check-can-send')).toHaveTextContent('yes')
    })

    it('should call onMultipleModelConfigsChange when invoked from context', () => {
      const onMultipleModelConfigsChange = vi.fn()

      render(
        <DebugWithMultipleModelContextProvider
          multipleModelConfigs={[]}
          onMultipleModelConfigsChange={onMultipleModelConfigsChange}
          onDebugWithMultipleModelChange={vi.fn()}
        >
          <TestConsumer />
        </DebugWithMultipleModelContextProvider>,
      )

      screen.getByTestId('call-on-change').click()

      expect(onMultipleModelConfigsChange).toHaveBeenCalledWith(true, [])
    })

    it('should call onDebugWithMultipleModelChange when invoked from context', () => {
      const onDebugWithMultipleModelChange = vi.fn()

      render(
        <DebugWithMultipleModelContextProvider
          multipleModelConfigs={[]}
          onMultipleModelConfigsChange={vi.fn()}
          onDebugWithMultipleModelChange={onDebugWithMultipleModelChange}
        >
          <TestConsumer />
        </DebugWithMultipleModelContextProvider>,
      )

      screen.getByTestId('call-on-debug-change').click()

      expect(onDebugWithMultipleModelChange).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'model-1' }),
      )
    })

    it('should handle undefined checkCanSend', () => {
      render(
        <DebugWithMultipleModelContextProvider
          multipleModelConfigs={[]}
          onMultipleModelConfigsChange={vi.fn()}
          onDebugWithMultipleModelChange={vi.fn()}
          checkCanSend={undefined}
        >
          <TestConsumer />
        </DebugWithMultipleModelContextProvider>,
      )

      expect(screen.getByTestId('has-check-can-send')).toHaveTextContent('no')
    })

    it('should render children correctly', () => {
      render(
        <DebugWithMultipleModelContextProvider
          multipleModelConfigs={[]}
          onMultipleModelConfigsChange={vi.fn()}
          onDebugWithMultipleModelChange={vi.fn()}
        >
          <div data-testid="child-element">Child Content</div>
        </DebugWithMultipleModelContextProvider>,
      )

      expect(screen.getByTestId('child-element')).toHaveTextContent('Child Content')
    })

    it('should update context when props change', () => {
      const { rerender } = render(
        <DebugWithMultipleModelContextProvider
          multipleModelConfigs={[createModelAndParameter()]}
          onMultipleModelConfigsChange={vi.fn()}
          onDebugWithMultipleModelChange={vi.fn()}
        >
          <TestConsumer />
        </DebugWithMultipleModelContextProvider>,
      )

      expect(screen.getByTestId('configs-count')).toHaveTextContent('1')

      rerender(
        <DebugWithMultipleModelContextProvider
          multipleModelConfigs={[createModelAndParameter(), createModelAndParameter({ id: 'model-2' })]}
          onMultipleModelConfigsChange={vi.fn()}
          onDebugWithMultipleModelChange={vi.fn()}
        >
          <TestConsumer />
        </DebugWithMultipleModelContextProvider>,
      )

      expect(screen.getByTestId('configs-count')).toHaveTextContent('2')
    })

    it('should pass all context values correctly', () => {
      const contextValues: DebugWithMultipleModelContextType = {
        multipleModelConfigs: [createModelAndParameter()],
        onMultipleModelConfigsChange: vi.fn(),
        onDebugWithMultipleModelChange: vi.fn(),
        checkCanSend: () => true,
      }

      const FullTestConsumer = () => {
        const context = useDebugWithMultipleModelContext()
        return (
          <div>
            <span data-testid="configs">{JSON.stringify(context.multipleModelConfigs)}</span>
            <span data-testid="has-on-change">{typeof context.onMultipleModelConfigsChange}</span>
            <span data-testid="has-on-debug-change">{typeof context.onDebugWithMultipleModelChange}</span>
            <span data-testid="has-check">{typeof context.checkCanSend}</span>
          </div>
        )
      }

      render(
        <DebugWithMultipleModelContextProvider {...contextValues}>
          <FullTestConsumer />
        </DebugWithMultipleModelContextProvider>,
      )

      expect(screen.getByTestId('configs')).toHaveTextContent('model-1')
      expect(screen.getByTestId('has-on-change')).toHaveTextContent('function')
      expect(screen.getByTestId('has-on-debug-change')).toHaveTextContent('function')
      expect(screen.getByTestId('has-check')).toHaveTextContent('function')
    })
  })
})
