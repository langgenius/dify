import { act, screen, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { useStore } from '@/app/components/workflow/store'
import { renderWithConsoleQuery, seedFeatures } from '@/test/console/query-data'
import { useWorkspaceCollaborationEnabled } from '../use-collaboration-enabled'

function WorkspaceState() {
  return <div>{useWorkspaceCollaborationEnabled() ? 'enabled' : 'disabled'}</div>
}

function SessionOwner({ children }: { children: React.ReactNode }) {
  const enabled = useWorkspaceCollaborationEnabled()
  return (
    <WorkflowContextProvider isCollaborationEnabled={enabled}>{children}</WorkflowContextProvider>
  )
}

function CollaborationState() {
  return <div>{useStore((s) => s.isCollaborationEnabled) ? 'enabled' : 'disabled'}</div>
}

describe('collaboration availability', () => {
  it.each([
    ['COMMUNITY', true, 'sandbox', 'enabled'],
    ['ENTERPRISE', true, 'sandbox', 'enabled'],
    ['CLOUD', true, 'sandbox', 'disabled'],
    ['CLOUD', true, 'professional', 'enabled'],
    ['CLOUD', true, 'team', 'enabled'],
    ['CLOUD', false, 'team', 'disabled'],
  ] as const)(
    'resolves %s with deployment switch %s and plan %s',
    (edition, enabled, plan, expected) => {
      renderWithConsoleQuery(<WorkspaceState />, {
        systemFeatures: { deployment_edition: edition, enable_collaboration_mode: enabled },
        features: { billing: { subscription: { plan } } },
      })
      expect(screen.getByText(expected)).toBeInTheDocument()
    },
  )

  it('waits for the Cloud subscription before selecting an editing mode', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    renderWithConsoleQuery(
      <Suspense fallback={<div>loading subscription</div>}>
        <WorkspaceState />
      </Suspense>,
      { systemFeatures: { deployment_edition: 'CLOUD', enable_collaboration_mode: true } },
    )
    expect(screen.getByText('loading subscription')).toBeInTheDocument()
    expect(screen.queryByText('enabled')).not.toBeInTheDocument()
    expect(screen.queryByText('disabled')).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    fetch.mockRestore()
  })

  it.each([
    ['sandbox', 'team', 'disabled'],
    ['team', 'sandbox', 'enabled'],
  ] as const)(
    'keeps the editor mode consistent when the plan changes from %s to %s',
    (initial, updated, expected) => {
      const { queryClient, rerender } = renderWithConsoleQuery(
        <SessionOwner>
          <CollaborationState />
        </SessionOwner>,
        {
          systemFeatures: { deployment_edition: 'CLOUD', enable_collaboration_mode: true },
          features: { billing: { subscription: { plan: initial } } },
        },
      )

      act(() => {
        seedFeatures(queryClient, { billing: { subscription: { plan: updated } } })
      })
      rerender(
        <SessionOwner>
          <CollaborationState />
          <CollaborationState />
        </SessionOwner>,
      )
      expect(screen.getAllByText(expected)).toHaveLength(2)
    },
  )
})
