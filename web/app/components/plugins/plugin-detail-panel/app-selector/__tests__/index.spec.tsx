import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import type { AppSelectorValue } from '../index'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { AppModeEnum } from '@/types/app'
import { AppSelector } from '../index'

const apps = [
  {
    id: 'app-1',
    name: 'Support Bot',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_url: null,
  },
  {
    id: 'app-2',
    name: 'Workflow App',
    mode: AppModeEnum.WORKFLOW,
    icon_type: 'emoji',
    icon: '⚙️',
    icon_background: '#E0EAFF',
    icon_url: null,
  },
  {
    id: 'app-3',
    name: 'Sales Bot',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '💼',
    icon_background: '#FEE4E2',
    icon_url: null,
  },
] satisfies AppPartial[]

const mockAppDetailQuery = vi.hoisted(() => vi.fn())
const mockUseAppWorkflow = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      get: {
        infiniteOptions: ({
          input,
          getNextPageParam,
          initialPageParam,
          placeholderData,
        }: {
          input: (pageParam: number) => { query: { name?: string } }
          getNextPageParam: (lastPage: { has_more: boolean; page: number }) => number | undefined
          initialPageParam: number
          placeholderData: unknown
        }) => ({
          queryKey: ['apps', input(1).query],
          queryFn: ({ pageParam = initialPageParam }: { pageParam?: number }) => {
            const query = input(Number(pageParam)).query
            const keyword = query.name?.toLowerCase() ?? ''
            const filteredApps = keyword
              ? apps.filter((app) => app.name.toLowerCase().includes(keyword))
              : apps

            return {
              data: filteredApps,
              has_more: false,
              page: Number(pageParam),
            }
          },
          getNextPageParam,
          initialPageParam,
          placeholderData,
        }),
      },
      byAppId: {
        get: {
          queryOptions: ({ input }: { input: unknown }) => {
            const appId =
              typeof input === 'object' && input && 'params' in input
                ? (input.params as { app_id: string }).app_id
                : undefined
            return {
              queryKey: ['apps', appId],
              queryFn: () => mockAppDetailQuery(appId),
              enabled: !!appId,
            }
          },
        },
      },
    },
  },
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: undefined,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: (appId: string) => mockUseAppWorkflow(appId),
}))

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}

function StatefulAppSelector({ onSelect }: { onSelect: (value: AppSelectorValue) => void }) {
  const [value, setValue] = useState<AppSelectorValue>()

  return (
    <AppSelector
      value={value}
      onSelect={(nextValue) => {
        setValue(nextValue)
        onSelect(nextValue)
      }}
    />
  )
}

describe('AppSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppDetailQuery.mockImplementation((appId: string) => apps.find((app) => app.id === appId))
    mockUseAppWorkflow.mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })
  })

  it('should start the workflow query before selected app detail resolves', async () => {
    const user = userEvent.setup()
    mockAppDetailQuery.mockReturnValue(new Promise(() => {}))
    mockUseAppWorkflow.mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    })

    renderWithQueryClient(
      <AppSelector value={{ app_id: 'app-2', inputs: {} }} onSelect={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'app.appSelector.label' }))

    await waitFor(() => {
      expect(mockUseAppWorkflow).toHaveBeenCalledWith('app-2')
    })
    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
  })

  it('should reset the input draft when switching apps', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    mockAppDetailQuery.mockImplementation((appId: string) => {
      const app = apps.find((item) => item.id === appId)
      if (!app) return undefined

      const isFirstApp = app.id === 'app-1'
      return {
        ...app,
        model_config: {
          user_input_form: [
            {
              'text-input': {
                label: isFirstApp ? 'First question' : 'Second question',
                variable: isFirstApp ? 'first_question' : 'second_question',
              },
            },
          ],
        },
      }
    })

    renderWithQueryClient(<StatefulAppSelector onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'app.appSelector.label' }))
    await user.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))
    await user.click(await screen.findByRole('option', { name: /Support Bot/ }))
    await user.type(await screen.findByPlaceholderText('First question'), 'alpha')

    await user.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))
    await user.click(await screen.findByRole('option', { name: /Sales Bot/ }))
    await user.type(await screen.findByPlaceholderText('Second question'), 'beta')

    expect(onSelect).toHaveBeenLastCalledWith({
      app_id: 'app-3',
      inputs: { second_question: 'beta' },
      files: [],
    })
  })

  it('should keep the main interaction: outer panel, inner app list, then inputs panel', async () => {
    const onSelect = vi.fn()

    renderWithQueryClient(<AppSelector onSelect={onSelect} />)

    const trigger = screen.getByRole('button', { name: 'app.appSelector.label' })
    expect(trigger).not.toHaveAttribute('data-popup-open')

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('data-popup-open', '')
    expect(screen.getByText('app.appSelector.label')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))

    await waitFor(() => {
      expect(screen.getByText('Support Bot')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Support Bot'))

    expect(onSelect).toHaveBeenCalledWith({
      app_id: 'app-1',
      inputs: {},
      files: [],
    })
    expect(screen.getByText('app.appSelector.label')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'app.appSelector.label' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Workflow App')).not.toBeInTheDocument()
    })
  })

  it('should search apps from the content input', async () => {
    renderWithQueryClient(<AppSelector onSelect={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'app.appSelector.label' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'app.appSelector.placeholder' }), {
      target: { value: 'workflow' },
    })

    await waitFor(() => {
      expect(screen.getByText('Workflow App')).toBeInTheDocument()
    })
    expect(screen.queryByText('Support Bot')).not.toBeInTheDocument()
  })

  it('should not keep the selected app in filtered results', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    renderWithQueryClient(<StatefulAppSelector onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'app.appSelector.label' }))
    await user.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))

    await waitFor(() => {
      expect(screen.getByText('Support Bot')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Support Bot'))
    await user.click(screen.getByRole('combobox', { name: 'app.appSelector.label' }))
    await user.type(
      screen.getByRole('combobox', { name: 'app.appSelector.placeholder' }),
      'workflow',
    )

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Support Bot/ })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: /Workflow App/ })).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onSelect).toHaveBeenLastCalledWith({
        app_id: 'app-2',
        inputs: {},
        files: [],
      })
    })
  })
})
