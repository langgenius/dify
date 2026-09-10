import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import AppInputsPanel from '../app-inputs-panel'

let mockHookResult = {
  inputFormSchema: [] as Array<Record<string, unknown>>,
  isError: false,
  isLoading: false,
  retry: vi.fn(),
}

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">Loading</div>,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-form', () => ({
  default: ({ onFormChange }: { onFormChange: (value: Record<string, unknown>) => void }) => (
    <button data-testid="app-inputs-form" onClick={() => onFormChange({ topic: 'updated' })}>
      Form
    </button>
  ),
}))

vi.mock(
  '@/app/components/plugins/plugin-detail-panel/app-selector/hooks/use-app-inputs-form-schema',
  () => ({
    useAppInputsFormSchema: () => mockHookResult,
  }),
)

describe('AppInputsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHookResult = {
      inputFormSchema: [],
      isError: false,
      isLoading: false,
      retry: vi.fn(),
    }
  })

  it('should render a loading state', () => {
    mockHookResult = {
      inputFormSchema: [],
      isError: false,
      isLoading: true,
      retry: vi.fn(),
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

  it('should render an error state and retry the owned queries', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    mockHookResult = {
      inputFormSchema: [],
      isError: true,
      isLoading: false,
      retry,
    }

    render(
      <AppInputsPanel
        value={{ app_id: 'app-1', inputs: {} }}
        appDetail={{ id: 'app-1' } as never}
        onFormChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('common.errorBoundary.title')
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(retry).toHaveBeenCalledTimes(1)
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
      isError: false,
      isLoading: false,
      retry: vi.fn(),
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
