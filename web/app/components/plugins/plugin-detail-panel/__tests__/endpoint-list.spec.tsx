import type { EndpointListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import EndpointList from '../endpoint-list'
import { createPluginDetail } from './endpoint-fixture'

const { request, showError } = vi.hoisted(() => ({ request: vi.fn(), showError: vi.fn() }))
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/app/notifications', () => ({ toast: { error: showError } }))
vi.mock('../../readme-panel/entrance', () => ({ ReadmeEntrance: () => null }))

const detail = createPluginDetail()

const createEndpoint = (): EndpointListItemResponse => ({
  id: 'ep-1',
  name: 'Endpoint 1',
  url: 'https://api.example.com',
  enabled: true,
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  settings: { enabled: false, count: '0', token: '', retry_count: 0 },
  tenant_id: 'tenant-1',
  plugin_id: 'test-plugin',
  expired_at: '',
  hook_id: 'hook-1',
  declaration: {
    settings: detail.declaration.endpoint?.settings ?? [],
    endpoints: [
      { method: 'GET', path: '/public' },
      { method: 'POST', path: '/hidden', hidden: true },
    ],
  },
})

let endpoints: EndpointListItemResponse[]
let rejectMutation: boolean
let failAfterWrite: boolean
let mutationGate: Promise<void> | undefined
const mutations: { path: string; method: string; body: unknown }[] = []

const renderEndpoints = () => render(<EndpointList detail={detail} />)

beforeEach(() => {
  vi.clearAllMocks()
  endpoints = [createEndpoint()]
  rejectMutation = false
  failAfterWrite = false
  mutationGate = undefined
  mutations.length = 0
  request.mockImplementation(
    async (url: string, _init: RequestInit, options: { request: Request }) => {
      const method = options.request.method
      const path = new URL(url).pathname.replace(/^.*\/workspaces/, '/workspaces')
      if (method === 'GET') return Response.json({ endpoints })
      const body: unknown = options.request.body ? await options.request.json() : undefined
      mutations.push({ path, method, body })
      await mutationGate
      if (rejectMutation && !failAfterWrite)
        return Response.json({ message: 'Failed' }, { status: 500 })
      if (path.endsWith('/enable'))
        endpoints = endpoints.map((item) => ({ ...item, enabled: true }))
      else if (path.endsWith('/disable'))
        endpoints = endpoints.map((item) => ({ ...item, enabled: false }))
      else if (method === 'DELETE') endpoints = []
      else endpoints = [{ ...createEndpoint(), name: 'Saved endpoint' }]
      if (rejectMutation) return Response.json({ message: 'Failed after write' }, { status: 500 })
      return Response.json({ success: true })
    },
  )
})

describe('Endpoint management', () => {
  it('loads the plugin endpoints and only displays public paths', async () => {
    renderEndpoints()
    expect(await screen.findByText('Endpoint 1')).toBeInTheDocument()
    expect(screen.getByText('https://api.example.com/public')).toBeInTheDocument()
    expect(screen.queryByText('https://api.example.com/hidden')).not.toBeInTheDocument()
    const requestedURL = new URL(request.mock.calls[0]![0])
    expect(requestedURL.searchParams.get('plugin_id')).toBe('test-plugin')
    expect(requestedURL.searchParams.get('page')).toBe('1')
    expect(requestedURL.searchParams.get('page_size')).toBe('100')
  })

  it('creates through the canonical route and refreshes the list', async () => {
    const user = userEvent.setup()
    endpoints = []
    renderEndpoints()
    await user.click(
      await screen.findByRole('button', { name: 'plugin.detailPanel.endpointModalTitle' }),
    )
    await user.clear(screen.getByPlaceholderText('Endpoint Name'))
    await user.type(screen.getByPlaceholderText('Endpoint Name'), 'Saved endpoint')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(await screen.findByText('Saved endpoint')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mutations).toEqual([
      {
        path: '/workspaces/current/endpoints',
        method: 'POST',
        body: {
          plugin_unique_identifier: 'test-uid',
          name: 'Saved endpoint',
          settings: { enabled: false, count: '0', token: '' },
        },
      },
    ])
  })

  it('updates through the canonical item route without dropping falsy settings', async () => {
    const user = userEvent.setup()
    renderEndpoints()
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    await user.clear(screen.getByPlaceholderText('Endpoint Name'))
    await user.type(screen.getByPlaceholderText('Endpoint Name'), 'Saved endpoint')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(await screen.findByText('Saved endpoint')).toBeInTheDocument()
    expect(mutations).toEqual([
      {
        path: '/workspaces/current/endpoints/ep-1',
        method: 'PATCH',
        body: {
          name: 'Saved endpoint',
          settings: { enabled: false, count: '0', token: '', retry_count: 0 },
        },
      },
    ])
  })

  it('keeps enabled state when disabling is cancelled, then follows refetched state after confirm', async () => {
    const user = userEvent.setup()
    renderEndpoints()
    await user.click(await screen.findByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(mutations).toHaveLength(0)
    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'))
    await user.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'))
    expect(mutations.map(({ path, body }) => ({ path, body }))).toEqual([
      { path: '/workspaces/current/endpoints/disable', body: { endpoint_id: 'ep-1' } },
      { path: '/workspaces/current/endpoints/enable', body: { endpoint_id: 'ep-1' } },
    ])
  })

  it('deletes through the canonical route and refreshes the empty state', async () => {
    const user = userEvent.setup()
    renderEndpoints()
    await user.click(await screen.findByRole('button', { name: 'common.operation.delete' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    expect(await screen.findByText('plugin.detailPanel.endpointsEmpty')).toBeInTheDocument()
    expect(mutations).toEqual([
      { path: '/workspaces/current/endpoints/ep-1', method: 'DELETE', body: undefined },
    ])
  })

  it('keeps edit values available when the mutation fails', async () => {
    const user = userEvent.setup()
    rejectMutation = true
    renderEndpoints()
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    await user.clear(screen.getByPlaceholderText('Endpoint Name'))
    await user.type(screen.getByPlaceholderText('Endpoint Name'), 'Saved endpoint')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(showError).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Endpoint 1')).toBeInTheDocument()
  })

  it.each(['edit', 'disable', 'delete'] as const)(
    'blocks duplicate %s while pending and retains the failed action for retry',
    async (action) => {
      const user = userEvent.setup()
      let settle: () => void = () => {}
      mutationGate = new Promise<void>((resolve) => {
        settle = resolve
      })
      rejectMutation = true
      renderEndpoints()
      if (action === 'disable') await user.click(await screen.findByRole('switch'))
      else
        await user.click(await screen.findByRole('button', { name: `common.operation.${action}` }))
      const actionName = action === 'edit' ? 'common.operation.save' : 'common.operation.confirm'
      const submit = screen.getByRole('button', { name: actionName })
      await user.click(submit)
      await waitFor(() => expect(submit).toHaveAttribute('aria-disabled', 'true'))
      expect(submit).toHaveFocus()
      expect(submit).not.toBeDisabled()
      await user.click(submit)
      expect(mutations).toHaveLength(1)
      await act(async () => {
        settle()
      })
      await waitFor(() => expect(showError).toHaveBeenCalled())
      expect(screen.getByRole('button', { name: actionName })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      )
      if (action === 'edit')
        expect(screen.getByPlaceholderText('Endpoint Name')).toHaveValue('Endpoint 1')
      else expect(screen.getByRole('alertdialog')).toBeInTheDocument()

      rejectMutation = false
      await user.click(screen.getByRole('button', { name: actionName }))
      await waitFor(() =>
        expect(
          screen.queryByRole(action === 'edit' ? 'dialog' : 'alertdialog'),
        ).not.toBeInTheDocument(),
      )
      expect(mutations).toHaveLength(2)
    },
  )

  it('refreshes a committed write after an error while preserving the editable form', async () => {
    const user = userEvent.setup()
    rejectMutation = true
    failAfterWrite = true
    renderEndpoints()
    await user.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    await user.clear(screen.getByPlaceholderText('Endpoint Name'))
    await user.type(screen.getByPlaceholderText('Endpoint Name'), 'Submitted name')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(showError).toHaveBeenCalled())
    expect(await screen.findByText('Saved endpoint')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Endpoint Name')).toHaveValue('Submitted name')
    expect(mutations).toHaveLength(1)
  })
})
