import type { ComponentProps, ReactNode } from 'react'
import type { Member } from '@/models/common'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'jotai'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { defaultSystemFeatures } from '@/features/system-features/config'
import { DatasetPermission } from '@/models/datasets'
import { createQueryAtomTestStore } from '@/test/query-atom'
import PermissionSelector from '../index'

const currentUser = {
  id: 'user-1',
  name: 'Current User',
  email: 'current@example.com',
  avatar: '',
  avatar_url: null,
  is_password_set: true,
  timezone: 'UTC',
}

const memberList: Member[] = [
  {
    ...currentUser,
    avatar_url: '',
    role: 'owner',
    roles: [],
    last_login_at: '',
    created_at: '',
    status: 'active',
  },
  {
    id: 'user-2',
    name: 'John Doe',
    email: 'john@example.com',
    avatar: '',
    avatar_url: '',
    role: 'admin',
    roles: [],
    last_login_at: '',
    created_at: '',
    status: 'active',
  },
  {
    id: 'user-3',
    name: 'Jane Smith',
    email: 'jane@example.com',
    avatar: '',
    avatar_url: '',
    role: 'normal',
    roles: [],
    last_login_at: '',
    created_at: '',
    status: 'active',
  },
]

const defaultProps: ComponentProps<typeof PermissionSelector> = {
  permission: DatasetPermission.onlyMe,
  value: ['user-1'],
  memberList,
  onChange: vi.fn(),
  onMemberSelect: vi.fn(),
}

const renderSelector = (
  props: Partial<ComponentProps<typeof PermissionSelector>> = {},
  options: { rbacEnabled?: boolean } = {},
) => {
  const { queryClient, store } = createQueryAtomTestStore()
  queryClient.setQueryData(userProfileQueryOptions().queryKey, {
    profile: currentUser,
    meta: { currentVersion: null, currentEnv: null },
  })
  queryClient.setQueryData(systemFeaturesQueryOptions().queryKey, {
    ...defaultSystemFeatures,
    deployment_edition: 'COMMUNITY',
    rbac_enabled: options.rbacEnabled ?? false,
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  )

  return render(<PermissionSelector {...defaultProps} {...props} />, { wrapper })
}

describe('PermissionSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens from its native button with the keyboard', async () => {
    const user = userEvent.setup()
    renderSelector()

    const trigger = screen.getByRole('button', { name: /permissionsOnlyMe/ })
    expect(trigger).toHaveAttribute('type', 'button')

    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    const dialog = screen.getByRole('dialog', { name: /form.permissions/ })
    expect(within(dialog).getByRole('radiogroup', { name: /form.permissions/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /permissionsOnlyMe/ })).toBeChecked()
  })

  it.each([
    ['the disabled prop', { disabled: true }, false],
    ['dataset RBAC', {}, true],
  ])('uses a disabled native trigger for %s', async (_, props, rbacEnabled) => {
    const user = userEvent.setup()
    renderSelector(props, { rbacEnabled })

    const trigger = rbacEnabled
      ? screen.getByRole('button', { name: /permissionsAccessConfig/ })
      : screen.getByRole('button', { name: /permissionsOnlyMe/ })
    expect(trigger).toBeDisabled()

    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    [DatasetPermission.onlyMe, /permissionsOnlyMe/],
    [DatasetPermission.allTeamMembers, /permissionsAllMember/],
  ])('selects %s and closes the popover', async (permission, optionName) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderSelector({
      permission:
        permission === DatasetPermission.onlyMe
          ? DatasetPermission.allTeamMembers
          : DatasetPermission.onlyMe,
      onChange,
    })

    await user.click(
      screen.getByRole('button', {
        name:
          permission === DatasetPermission.onlyMe ? /permissionsAllMember/ : /permissionsOnlyMe/,
      }),
    )
    const popover = screen.getByRole('dialog', { name: /form.permissions/ })
    await user.click(within(popover).getByRole('radio', { name: optionName }))

    expect(onChange).toHaveBeenCalledWith(permission)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('resets partial access to the current user and keeps the popover open', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onMemberSelect = vi.fn()
    renderSelector({ onChange, onMemberSelect })

    await user.click(screen.getByRole('button', { name: /permissionsOnlyMe/ }))
    const popover = screen.getByRole('dialog', { name: /form.permissions/ })
    await user.click(within(popover).getByRole('radio', { name: /permissionsInvitedMembers/ }))

    expect(onChange).toHaveBeenCalledWith(DatasetPermission.partialMembers)
    expect(onMemberSelect).toHaveBeenCalledWith(['user-1'])
    expect(screen.getByRole('dialog', { name: /form.permissions/ })).toBeInTheDocument()
  })

  it('uses radio keyboard navigation without closing the popover', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderSelector({ onChange })

    await user.click(screen.getByRole('button', { name: /permissionsOnlyMe/ }))
    const dialog = screen.getByRole('dialog', { name: /form.permissions/ })
    const onlyMe = within(dialog).getByRole('radio', { name: /permissionsOnlyMe/ })
    onlyMe.focus()
    await user.keyboard('{ArrowDown}')

    expect(onChange).toHaveBeenCalledWith(DatasetPermission.allTeamMembers)
    expect(dialog).toBeInTheDocument()
  })

  it.each([
    [['user-1'], ['user-1', 'user-2']],
    [['user-1', 'user-2'], ['user-1']],
  ])('toggles a member using a native button', async (value, expectedValue) => {
    const user = userEvent.setup()
    const onMemberSelect = vi.fn()
    renderSelector({
      permission: DatasetPermission.partialMembers,
      value,
      onMemberSelect,
    })

    await user.click(screen.getByRole('button', { name: /Current User/ }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /John Doe/ }))

    expect(onMemberSelect).toHaveBeenCalledWith(expectedValue)
  })

  it('filters members after the search debounce and clears the query', async () => {
    const user = userEvent.setup()
    renderSelector({ permission: DatasetPermission.partialMembers })

    await user.click(screen.getByRole('button', { name: /Current User/ }))
    const search = screen.getByRole('textbox', { name: /operation.search/ })
    await user.type(search, 'Jane')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Jane Smith/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /John Doe/ })).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /operation.clear/ }))
    expect(search).toHaveValue('')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /John Doe/ })).toBeInTheDocument()
    })
  })

  it('shows the empty state when no member matches', async () => {
    const user = userEvent.setup()
    renderSelector({ permission: DatasetPermission.partialMembers })

    await user.click(screen.getByRole('button', { name: /Current User/ }))
    await user.type(screen.getByRole('textbox', { name: /operation.search/ }), 'Nobody')

    expect(await screen.findByText(/form.onSearchResults/)).toBeInTheDocument()
  })
})
