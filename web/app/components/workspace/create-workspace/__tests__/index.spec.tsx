import type { WorkspaceActivationResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ConsoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createTestQueryClient } from '@/test/query-client'
import CreateWorkspace from '..'

const activate = vi.hoisted(() => vi.fn<ConsoleClient['workspaces']['activate']['post']>())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.activate.post': activate,
    }),
  }
})

const nameLabel = 'common.workspace.create.name'
const continueLabel = 'common.workspace.create.continue'
const requiredMessage = 'common.workspace.create.nameRequired'
const activatedWorkspace: WorkspaceActivationResponse = {
  workspace_id: 'workspace-1',
  first_workspace_created_at: 1793786400,
}
const clients: ReturnType<typeof createTestQueryClient>[] = []

function renderPage() {
  const queryClient = createTestQueryClient()
  clients.push(queryClient)
  return renderWithConsoleQuery(<CreateWorkspace />, {
    queryClient,
    accountProfile: null,
    currentWorkspace: null,
  })
}

describe('CreateWorkspace', () => {
  beforeEach(() => {
    activate.mockReset()
    activate.mockResolvedValue(activatedWorkspace)
    vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const client of clients.splice(0)) client.clear()
    vi.restoreAllMocks()
  })

  it.each(['', '   '])(
    'rejects an empty workspace name (%j) and focuses the field',
    async (name) => {
      const user = userEvent.setup()
      renderPage()
      const input = screen.getByRole('textbox', { name: nameLabel })

      if (name) await user.type(input, name)
      await user.click(screen.getByRole('button', { name: continueLabel }))

      expect(await screen.findByText(requiredMessage)).toBeInTheDocument()
      expect(input).toHaveAttribute('aria-invalid', 'true')
      await waitFor(() => expect(input).toHaveFocus())
      expect(activate).not.toHaveBeenCalled()
      expect(window.location.assign).not.toHaveBeenCalled()
    },
  )

  it('clears a required error and creates the workspace after correcting the name', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: nameLabel })

    await user.click(screen.getByRole('button', { name: continueLabel }))
    expect(await screen.findByText(requiredMessage)).toBeInTheDocument()
    await user.type(input, 'Product team')
    await user.click(screen.getByRole('button', { name: continueLabel }))

    await waitFor(() => expect(screen.queryByText(requiredMessage)).not.toBeInTheDocument())
    expect(input).toHaveValue('Product team')
    expect(activate.mock.calls[0]?.[0]).toEqual({ body: { name: 'Product team' } })
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/'))
  })

  it('validates the name when submitting with Enter', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: nameLabel })

    await user.click(input)
    await user.keyboard('{Enter}')

    expect(await screen.findByText(requiredMessage)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(activate).not.toHaveBeenCalled()
  })

  it('trims the name and waits for creation before navigating, blocking duplicate submissions', async () => {
    const user = userEvent.setup()
    let finishCreation!: (result: WorkspaceActivationResponse) => void
    activate.mockReturnValueOnce(
      new Promise<WorkspaceActivationResponse>((resolve) => {
        finishCreation = resolve
      }),
    )
    renderPage()
    const input = screen.getByRole('textbox', { name: nameLabel })
    const submit = screen.getByRole('button', { name: continueLabel })

    await user.type(input, '  Research team  {Enter}')
    await waitFor(() => expect(activate).toHaveBeenCalledOnce())
    expect(activate.mock.calls[0]?.[0]).toEqual({ body: { name: 'Research team' } })
    expect(input).toHaveAttribute('readonly')
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    expect(window.location.assign).not.toHaveBeenCalled()

    await user.click(submit)
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(activate).toHaveBeenCalledOnce()

    await act(async () => {
      finishCreation(activatedWorkspace)
    })
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/'))
    expect(window.location.assign).toHaveBeenCalledOnce()
    await user.click(submit)
    expect(activate).toHaveBeenCalledOnce()
  })

  it('keeps the name and displays a server error until a retry succeeds', async () => {
    const user = userEvent.setup()
    activate.mockRejectedValueOnce(
      new ORPCError('not_allowed_create_workspace', {
        status: 400,
        message: 'Workspace creation is not allowed.',
      }),
    )
    renderPage()
    const input = screen.getByRole('textbox', { name: nameLabel })
    const submit = screen.getByRole('button', { name: continueLabel })
    await user.type(input, 'Research team')
    await user.click(submit)

    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace creation is not allowed.')
    expect(input).toHaveValue('Research team')
    expect(input).not.toHaveAttribute('readonly')
    expect(submit).not.toHaveAttribute('aria-disabled', 'true')
    expect(window.location.assign).not.toHaveBeenCalled()

    await user.click(submit)
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('/'))
    expect(activate).toHaveBeenCalledTimes(2)
    expect(activate.mock.calls[1]?.[0]).toEqual({ body: { name: 'Research team' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('links back to My apps', () => {
    renderPage()

    expect(
      screen.getByRole('link', { name: 'common.workspace.create.backToMyApps' }),
    ).toHaveAttribute('href', '/my-apps')
  })
})
