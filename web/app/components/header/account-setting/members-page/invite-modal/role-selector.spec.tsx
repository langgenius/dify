import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { useProviderContext } from '@/context/provider-context'
import RoleSelector from './role-selector'

vi.mock('@/context/provider-context')

type WrapperProps = {
  initialRole?: 'normal' | 'editor' | 'admin' | 'dataset_operator'
}

const RoleSelectorWrapper = ({ initialRole = 'normal' }: WrapperProps) => {
  const [role, setRole] = useState<'normal' | 'editor' | 'admin' | 'dataset_operator'>(initialRole)
  return <RoleSelector value={role} onChange={setRole} />
}

describe('RoleSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProviderContext).mockReturnValue({
      datasetOperatorEnabled: true,
    } as unknown as ReturnType<typeof useProviderContext>)
  })

  it('should show current role in trigger text', () => {
    render(<RoleSelectorWrapper initialRole="admin" />)

    expect(screen.getByText(/members\.invitedAsRole/i)).toBeInTheDocument()
  })

  it.each([
    'common.members.admin',
    'common.members.editor',
    'common.members.datasetOperator',
  ])('should update selected role after user chooses %s', async (nextRoleLabel) => {
    const user = userEvent.setup()

    render(<RoleSelectorWrapper initialRole="normal" />)

    await user.click(screen.getByText(/members\.invitedAsRole/i))
    await user.click(screen.getByText(nextRoleLabel))

    expect(screen.getByText(new RegExp(nextRoleLabel.replace('.', '\\.'), 'i'))).toBeInTheDocument()
  })

  it('should hide dataset operator option when feature is disabled', async () => {
    const user = userEvent.setup()

    vi.mocked(useProviderContext).mockReturnValue({
      datasetOperatorEnabled: false,
    } as unknown as ReturnType<typeof useProviderContext>)

    render(<RoleSelectorWrapper />)

    await user.click(screen.getByText(/members\.invitedAsRole/i))

    expect(screen.queryByText('common.members.datasetOperator')).not.toBeInTheDocument()
  })
})
