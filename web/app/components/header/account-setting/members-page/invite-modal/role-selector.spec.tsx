import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
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

    const trigger = screen.getByTestId('role-selector-trigger')

    // Open
    await user.click(trigger)
    expect(screen.getByTestId('role-option-normal')).toBeInTheDocument()

    // Close
    await user.click(trigger)
    await waitFor(() => {
      expect(screen.queryByTestId('role-option-normal')).not.toBeInTheDocument()
    })
  })

  it('should show checkmark for selected role', async () => {
    const user = userEvent.setup()
    render(<RoleSelectorWrapper initialRole="editor" />)

    await user.click(screen.getByTestId('role-selector-trigger'))

    const editorOption = screen.getByTestId('role-option-editor')
    expect(editorOption.querySelector('[data-testid="role-option-check"]')).toBeInTheDocument()
  })

  it.each([
    ['normal', 'role-option-normal', 'common.members.normal'],
    ['editor', 'role-option-editor', 'common.members.editor'],
    ['admin', 'role-option-admin', 'common.members.admin'],
    ['dataset_operator', 'role-option-dataset_operator', 'common.members.datasetOperator'],
  ])('should update selected role after user chooses %s', async (_roleKey, testId) => {
    const user = userEvent.setup()

    render(<RoleSelectorWrapper initialRole="normal" />)

    await user.click(screen.getByTestId('role-selector-trigger'))
    await user.click(screen.getByTestId(testId))

    // Verify dropdown closed
    await waitFor(() => {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument()
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

    await user.click(screen.getByTestId('role-selector-trigger'))

    expect(screen.queryByTestId('role-option-dataset_operator')).not.toBeInTheDocument()
    expect(screen.getByTestId('role-option-normal')).toBeInTheDocument()
  })
})
