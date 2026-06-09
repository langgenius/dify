import { render } from '@testing-library/react'
import * as React from 'react'
import { useConfiguration } from '../hooks/use-configuration'
import Configuration from '../index'

const mockView = vi.fn((_: unknown) => <div data-testid="configuration-view" />)

vi.mock('../configuration-view', () => ({
  default: (props: unknown) => mockView(props),
}))

vi.mock('../hooks/use-configuration', () => ({
  useConfiguration: vi.fn(),
}))

describe('Configuration entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass the hook view model into ConfigurationView', () => {
    const viewModel = {
      showLoading: true,
    }
    vi.mocked(useConfiguration).mockReturnValue(viewModel as never)

    render(<Configuration />)

    expect(useConfiguration).toHaveBeenCalledTimes(1)
    expect(mockView).toHaveBeenCalledWith(viewModel)
  })
})
