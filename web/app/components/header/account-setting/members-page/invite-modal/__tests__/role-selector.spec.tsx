import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { useProviderContext } from '@/context/provider-context'
import RoleSelector from '../role-selector'

vi.mock('@/context/provider-context')

type WrapperProps = {
  initialRole?: 'normal' | 'editor' | 'admin' | 'dataset_operator'
}

const RoleSelectorWrapper = ({ initialRole = 'normal' }: WrapperProps) => {
  const [role, setRole] = useState<'normal' | 'editor' | 'admin' | 'dataset_operator'>(initialRole)
  return <RoleSelector value={role} onChange={setRole} />
}

const getTrigger = () => screen.getByRole('button', { name: /members\.invitedAsRole/i })
const getRoleDialog = () => screen.getByRole('dialog')
const getRoleOption = (role: string) => within(getRoleDialog()).getByRole('button', { name: new RegExp(`common\\.members\\.${role}`, 'i') })

describe('RoleSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      datasetOperatorEnabled: true,
    }))
  })

  it('should show current role in trigger text', () => {
    render(<RoleSelectorWrapper initialRole="admin" />)

    // members.invitedAsRole is the translation key
    expect(screen.getByText(/members\.invitedAsRole/i)).toBeInTheDocument()
  })

  it('should toggle dropdown when trigger is clicked', async () => {
    const user = userEvent.setup()
    render(<RoleSelectorWrapper />)

    const trigger = getTrigger()

    // Open
    await user.click(trigger)
    expect(getRoleOption('normal')).toBeInTheDocument()

    // Close
    await user.click(trigger)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('should show checkmark for selected role', async () => {
    const user = userEvent.setup()
    render(<RoleSelectorWrapper initialRole="editor" />)

    await user.click(getTrigger())

    expect(getRoleOption('editor')).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([
    ['normal'],
    ['editor'],
    ['admin'],
    ['datasetOperator'],
  ])('should update selected role after user chooses %s', async (roleKey) => {
    const user = userEvent.setup()

    render(<RoleSelectorWrapper initialRole="normal" />)

    await user.click(getTrigger())
    await user.click(getRoleOption(roleKey))

    // Verify dropdown closed
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // Verify trigger text updated (using translation key pattern from global mock)
    expect(screen.getByText(/members\.invitedAsRole/i)).toBeInTheDocument()
  })

  it('should hide dataset operator option when feature is disabled', async () => {
    const user = userEvent.setup()

    vi.mocked(useProviderContext).mockReturnValue(createMockProviderContextValue({
      datasetOperatorEnabled: false,
    }))

    render(<RoleSelectorWrapper />)

    await user.click(getTrigger())

    expect(within(getRoleDialog()).queryByRole('button', { name: /common\.members\.datasetOperator/i })).not.toBeInTheDocument()
    expect(getRoleOption('normal')).toBeInTheDocument()
  })
})
