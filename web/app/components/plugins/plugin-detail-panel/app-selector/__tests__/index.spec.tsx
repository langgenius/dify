import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { AppSelectorValue } from '../index'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { AppSelector } from '../index'

const apps = [
  {
    id: 'app-1',
    name: 'Support Bot',
    mode: 'chat' as const,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_url: null,
  },
  {
    id: 'app-2',
    name: 'Workflow App',
    mode: 'workflow' as const,
    icon_type: 'emoji',
    icon: '⚙️',
    icon_background: '#E0EAFF',
    icon_url: null,
  },
  {
    id: 'app-3',
    name: 'Sales Bot',
    mode: 'chat' as const,
    icon_type: 'emoji',
    icon: '💼',
    icon_background: '#FEE4E2',
    icon_url: null,
  },
] satisfies AppPartial[]

const { fetchApps, fetchApp, fetchWorkflow } = vi.hoisted(() => ({
  fetchApps: vi.fn(),
  fetchApp: vi.fn(),
  fetchWorkflow: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.get': fetchApps,
      'apps.byAppId.get': fetchApp,
      'apps.byAppId.workflows.publish.get': fetchWorkflow,
      'files.upload.get': () => ({}),
    }),
  }
})

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
    fetchApps.mockImplementation(({ query }: { query: { name: string; page: number } }) => ({
      data: apps.filter((app) => app.name.toLowerCase().includes(query.name.toLowerCase())),
      page: query.page,
      has_more: false,
    }))
    fetchApp.mockImplementation(({ params }: { params: { app_id: string } }) =>
      createAppDetailFixture(apps.find((app) => app.id === params.app_id)),
    )
    fetchWorkflow.mockResolvedValue({ graph: { nodes: [] }, features: {} })
  })

  it('should start the workflow request before selected app detail resolves', async () => {
    const user = userEvent.setup()
    fetchApp.mockReturnValue(new Promise(() => {}))
    fetchWorkflow.mockReturnValue(new Promise(() => {}))

    renderWithConsoleQuery(
      <AppSelector value={{ app_id: 'app-2', inputs: {} }} onSelect={vi.fn()} />,
    )

    await user.click(await screen.findByRole('button', { name: 'Workflow App' }))

    await waitFor(() => {
      expect(fetchWorkflow).toHaveBeenCalledWith({ params: { app_id: 'app-2' } })
    })
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
  })

  it('should reset the input draft when switching apps', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    fetchApp.mockImplementation(({ params }: { params: { app_id: string } }) => {
      const app = apps.find((item) => item.id === params.app_id)
      if (!app) return undefined

      const isFirstApp = app.id === 'app-1'
      return createAppDetailFixture({
        ...app,
        model_config: createAppModelConfigFixture({
          user_input_form: [
            {
              'text-input': {
                label: isFirstApp ? 'First question' : 'Second question',
                variable: isFirstApp ? 'first_question' : 'second_question',
              },
            },
          ],
        }),
      })
    })

    renderWithConsoleQuery(<StatefulAppSelector onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'app.appSelector.placeholder' }))
    await user.click(screen.getAllByRole('button', { name: 'app.appSelector.placeholder' })[1]!)
    await user.click(await screen.findByRole('option', { name: /Support Bot/ }))
    await user.type(await screen.findByPlaceholderText('First question'), 'alpha')

    await user.click(screen.getAllByRole('button', { name: 'Support Bot' })[1]!)
    await user.click(await screen.findByRole('option', { name: /Sales Bot/ }))
    await user.type(await screen.findByPlaceholderText('Second question'), 'beta')

    expect(onSelect).toHaveBeenLastCalledWith({
      app_id: 'app-3',
      inputs: { second_question: 'beta' },
      files: [],
    })
  })

  it('should not keep the selected app in filtered results', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    renderWithConsoleQuery(<StatefulAppSelector onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'app.appSelector.placeholder' }))
    await user.click(screen.getAllByRole('button', { name: 'app.appSelector.placeholder' })[1]!)

    await waitFor(() => {
      expect(screen.getByText('Support Bot')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Support Bot'))
    expect(onSelect).toHaveBeenLastCalledWith({ app_id: 'app-1', inputs: {}, files: [] })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Support Bot' })[1]!)
    await user.type(
      screen.getByRole('combobox', { name: 'app.appSelector.searchPlaceholder' }),
      'workflow',
    )

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Support Bot/ })).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('option', { name: /Workflow App/ })).toBeInTheDocument()

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
  it('preserves inputs and files when the current app is selected again', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const value = {
      app_id: 'app-1',
      inputs: { question: 'Keep this draft' },
      files: ['attachment'],
    }
    renderWithConsoleQuery(<AppSelector value={value} onSelect={onSelect} />)
    await user.click(await screen.findByRole('button', { name: 'Support Bot' }))
    await user.click(screen.getAllByRole('button', { name: 'Support Bot' })[1]!)
    await user.click(await screen.findByRole('option', { name: /Support Bot/ }))
    expect(onSelect).toHaveBeenLastCalledWith(value)
  })
})
