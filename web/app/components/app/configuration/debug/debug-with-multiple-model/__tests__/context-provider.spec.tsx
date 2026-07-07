import { render, screen } from '@testing-library/react'
import { useDebugWithMultipleModelContext } from '../context'
import { DebugWithMultipleModelContextProvider } from '../context-provider'

const ContextConsumer = () => {
  const value = useDebugWithMultipleModelContext()
  return (
    <div>
      <div>{value.multipleModelConfigs.length}</div>
      <button onClick={() => value.onMultipleModelConfigsChange(true, value.multipleModelConfigs)}>change-multiple</button>
      <button onClick={() => value.onDebugWithMultipleModelChange(value.multipleModelConfigs[0]!)}>change-single</button>
      <div>{String(value.checkCanSend?.())}</div>
    </div>
  )
}

describe('DebugWithMultipleModelContextProvider', () => {
  it('should expose the provided context value to descendants', () => {
    const onMultipleModelConfigsChange = vi.fn()
    const onDebugWithMultipleModelChange = vi.fn()
    const checkCanSend = vi.fn(() => true)
    const multipleModelConfigs = [{ model: 'gpt-4o' }] as unknown as []

    render(
      <DebugWithMultipleModelContextProvider
        multipleModelConfigs={multipleModelConfigs}
        onMultipleModelConfigsChange={onMultipleModelConfigsChange}
        onDebugWithMultipleModelChange={onDebugWithMultipleModelChange}
        checkCanSend={checkCanSend}
      >
        <ContextConsumer />
      </DebugWithMultipleModelContextProvider>,
    )

    expect(screen.getByText('1'))!.toBeInTheDocument()
    expect(screen.getByText('true'))!.toBeInTheDocument()
  })
})
