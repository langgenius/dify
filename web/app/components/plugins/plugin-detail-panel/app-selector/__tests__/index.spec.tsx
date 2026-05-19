import type { ReactNode } from 'react'
import type { AppSelectorValue } from '../index'
import type { App } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModeEnum } from '@/types/app'
import { AppSelector } from '../index'

const apps: App[] = [
  {
    id: 'app-1',
    name: 'Support Bot',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
    model_config: {
      user_input_form: [],
    },
  } as unknown as App,
  {
    id: 'app-2',
    name: 'Workflow App',
    mode: AppModeEnum.WORKFLOW,
    icon_type: 'emoji',
    icon: '⚙️',
    icon_background: '#E0EAFF',
  } as unknown as App,
]

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      list: {
        infiniteOptions: ({
          input,
          getNextPageParam,
          initialPageParam,
          placeholderData,
        }: {
          input: (pageParam: number) => { query: { name?: string } }
          getNextPageParam: (lastPage: { has_more: boolean, page: number }) => number | undefined
          initialPageParam: number
          placeholderData: unknown
        }) => ({
          queryKey: ['apps', input(1).query],
          queryFn: ({ pageParam = initialPageParam }: { pageParam?: number }) => {
            const query = input(Number(pageParam)).query
            const keyword = query.name?.toLowerCase() ?? ''
            const filteredApps = keyword
              ? apps.filter(app => app.name.toLowerCase().includes(keyword))
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
    },
  },
}))

vi.mock('@/service/use-apps', () => ({
  useAppDetail: (appId: string) => ({
    data: apps.find(app => app.id === appId),
  }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({ data: undefined }),
}))

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({ data: undefined, isFetching: false }),
}))

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>,
  )
}

function StatefulAppSelector({
  onSelect,
}: {
  onSelect: (value: AppSelectorValue) => void
}) {
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
  })

  it('should keep the main interaction: outer panel, inner app list, then inputs panel', async () => {
    const onSelect = vi.fn()

    renderWithQueryClient(<AppSelector onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: 'app.appSelector.label' }))
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
    await user.type(screen.getByRole('combobox', { name: 'app.appSelector.placeholder' }), 'workflow')

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
