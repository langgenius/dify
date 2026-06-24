import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeploymentActionsMenu } from './index'

type QueryOptions = {
  input?: unknown
  queryKey?: readonly unknown[]
}

const editDialogMock = vi.hoisted(() => vi.fn())
const deleteDialogMock = vi.hoisted(() => vi.fn())
const prefetchQueryMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    prefetchQuery: prefetchQueryMock,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        getAppInstance: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getAppInstance', options.input],
          }),
        },
      },
    },
  },
}))

vi.mock('./edit-dialog', async () => {
  const { useAtomValue } = await import('jotai')
  const { editDeploymentDialogOpenAtom } = await import('./state')

  return {
    EditDeploymentDialog: () => {
      const open = useAtomValue(editDeploymentDialogOpenAtom)
      editDialogMock({ open })

      return <div data-testid="edit-dialog" data-open={String(open)} />
    },
  }
})

vi.mock('./delete-dialog', async () => {
  const { useAtomValue } = await import('jotai')
  const { deleteDeploymentDialogOpenAtom } = await import('./state')

  return {
    DeleteDeploymentDialog: () => {
      const open = useAtomValue(deleteDeploymentDialogOpenAtom)
      deleteDialogMock({ open })

      return <div data-testid="delete-dialog" data-open={String(open)} />
    },
  }
})

describe('DeploymentActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the trigger wrapper visible through uncontrolled menu state', () => {
    const { container } = render(
      <DeploymentActionsMenu
        appInstanceId="app-instance-1"
        placement="bottom-end"
        className="pointer-events-none opacity-0"
      />,
    )

    const wrapper = container.querySelector('[role="presentation"]') as HTMLElement
    expect(wrapper).toHaveClass(
      'pointer-events-none',
      'opacity-0',
      '[&:has([data-popup-open])]:pointer-events-auto',
      '[&:has([data-popup-open])]:opacity-100',
    )
  })

  it('prefetches the app instance when the menu opens', async () => {
    const user = userEvent.setup()

    render(
      <DeploymentActionsMenu
        appInstanceId="app-instance-1"
        placement="bottom-end"
      />,
    )

    expect(prefetchQueryMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'deployments.card.moreActions' }))
    await screen.findByRole('menuitem', { name: 'deployments.card.menu.editInfo' })

    expect(prefetchQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        params: {
          appInstanceId: 'app-instance-1',
        },
      },
      queryKey: ['getAppInstance', {
        params: {
          appInstanceId: 'app-instance-1',
        },
      }],
    }))
  })

  it('opens edit and delete dialogs from menu items', async () => {
    const user = userEvent.setup()

    render(
      <DeploymentActionsMenu
        appInstanceId="app-instance-1"
        placement="bottom-end"
      />,
    )

    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('delete-dialog')).toHaveAttribute('data-open', 'false')

    await user.click(screen.getByRole('button', { name: 'deployments.card.moreActions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'deployments.card.menu.editInfo' }))

    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('delete-dialog')).toHaveAttribute('data-open', 'false')

    await user.click(screen.getByRole('button', { name: 'deployments.card.moreActions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'deployments.card.menu.delete' }))

    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('delete-dialog')).toHaveAttribute('data-open', 'true')
    expect(editDialogMock).toHaveBeenLastCalledWith({ open: false })
    expect(deleteDialogMock).toHaveBeenLastCalledWith({ open: true })
  })
})
