import type { ReactElement } from 'react'
import { AccessSubjectType } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { DeploymentAccessControlDialog } from '../access-control-dialog'

const mockUseSearchAccessSubjects = vi.hoisted(() => vi.fn())

vi.mock('@/service/access-control/use-access-subjects', () => ({
  useSearchAccessSubjects: (...args: unknown[]) => mockUseSearchAccessSubjects(...args),
}))

const render = (ui: ReactElement, allowPublicAccess = true) =>
  renderWithSystemFeatures(ui, {
    systemFeatures: { webapp_auth: { allow_public_access: allowPublicAccess } },
  })

describe('DeploymentAccessControlDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSearchAccessSubjects.mockReturnValue({
      data: { pages: [] },
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  it('should submit the selected deployment access subjects', () => {
    const handleSubmit = vi.fn()

    render(
      <DeploymentAccessControlDialog
        open
        initialKind="specific"
        initialSubjects={[
          {
            id: 'group-1',
            subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
            name: 'Group One',
            memberCount: 2,
          },
          {
            id: 'member-1',
            subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
            name: 'Member One',
          },
        ]}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

    expect(handleSubmit).toHaveBeenCalledWith('specific', [
      {
        id: 'group-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
        name: 'Group One',
        memberCount: 2,
      },
      {
        id: 'member-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
        name: 'Member One',
      },
    ])
  })

  describe('public access control', () => {
    it('should allow selecting the public option when public access is allowed', () => {
      const handleSubmit = vi.fn()

      render(
        <DeploymentAccessControlDialog
          open
          initialKind="organization"
          initialSubjects={[]}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
        />,
        true,
      )

      const publicOption = screen.getByRole('radio', {
        name: 'app.accessControlDialog.accessItems.anyone',
      })
      expect(publicOption).not.toHaveAttribute('data-disabled')

      fireEvent.click(publicOption)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleSubmit).toHaveBeenCalledWith('anyone', [])
    })

    it('should disable the public option and show a tooltip when public access is disabled', () => {
      const handleSubmit = vi.fn()

      render(
        <DeploymentAccessControlDialog
          open
          initialKind="organization"
          initialSubjects={[]}
          onClose={vi.fn()}
          onSubmit={handleSubmit}
        />,
        false,
      )

      const publicOption = screen.getByRole('radio', {
        name: 'app.accessControlDialog.accessItems.anyone',
      })
      expect(publicOption).toHaveAttribute('data-disabled')
      expect(
        screen.getByRole('button', {
          name: 'app.accessControlDialog.webAppPublicAccessDisabledTip',
        }),
      ).toBeInTheDocument()

      fireEvent.click(publicOption)
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleSubmit).toHaveBeenCalledWith('organization', [])
    })
  })
})
