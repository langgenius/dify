import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppInputsPanel from '../app-inputs-panel'

let mockHookResult = {
  inputFormSchema: [] as Array<Record<string, unknown>>,
  isLoading: false,
}

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">Loading</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-form', () => ({
  default: ({
    onFormChange,
  }: {
    onFormChange: (value: Record<string, unknown>) => void
  }) => (
    <button data-testid="app-inputs-form" onClick={() => onFormChange({ topic: 'updated' })}>
      Form
    </button>
  ),
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector/hooks/use-app-inputs-form-schema', () => ({
  useAppInputsFormSchema: () => mockHookResult,
}))

describe('AppInputsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHookResult = {
      inputFormSchema: [],
      isLoading: false,
    }
  })

  it('should render a loading state', () => {
    mockHookResult = {
      inputFormSchema: [],
      isLoading: true,
    }

    render(
      <AppInputsPanel
        value={{ app_id: 'app-1', inputs: {} }}
        appDetail={{ id: 'app-1' } as never}
        onFormChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('should render an empty state when no inputs are available', () => {
    render(
      <AppInputsPanel
        value={{ app_id: 'app-1', inputs: {} }}
        appDetail={{ id: 'app-1' } as never}
        onFormChange={vi.fn()}
      />,
    )

    expect(screen.getByText('app.appSelector.noParams')).toBeInTheDocument()
  })

  it('should render the inputs form and propagate changes', () => {
    const onFormChange = vi.fn()
    mockHookResult = {
      inputFormSchema: [{ variable: 'topic' }],
      isLoading: false,
    }

    render(
      <AppInputsPanel
        value={{ app_id: 'app-1', inputs: { topic: 'initial' } }}
        appDetail={{ id: 'app-1' } as never}
        onFormChange={onFormChange}
      />,
    )

    fireEvent.click(screen.getByTestId('app-inputs-form'))

    expect(onFormChange).toHaveBeenCalledWith({ topic: 'updated' })
  })
})
