import type { ComponentProps } from 'react'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import datasetSettings from '@/i18n/locales/en-US/dataset-settings.json'
import { PermissionLevel } from '@/models/permission'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import PermissionSelector from '../index'

vi.unmock('react-i18next')

const memberList = [
  { id: 'user-1', name: 'Current User', email: 'current@example.com', avatar_url: '' },
  { id: 'user-2', name: 'John Doe', email: 'john@example.com', avatar_url: '' },
  { id: 'user-3', name: 'Jane Smith', email: 'jane@example.com', avatar_url: '' },
]
type SelectorProps = ComponentProps<typeof PermissionSelector>
type Options = Partial<
  Pick<
    SelectorProps,
    | 'disabled'
    | 'disableWhenRbacEnabled'
    | 'permissionChangeDisabled'
    | 'permission'
    | 'value'
    | 'invalid'
  >
>

// The reusable selector is controlled; this caller accepts its public changes without duplicating its logic.
function ControlledSelector({
  permission: initialPermission = PermissionLevel.onlyMe,
  value: initialValue = ['user-1'],
  ...props
}: Options) {
  const [permission, setPermission] = useState<SelectorProps['permission']>(initialPermission)
  const [value, setValue] = useState(initialValue)
  return (
    <>
      <span id="permission-label">Knowledge permission</span>
      <span id="permission-help">Choose who can read this knowledge.</span>
      <PermissionSelector
        {...props}
        ariaLabelledBy="permission-label"
        ariaDescribedBy="permission-help"
        permission={permission}
        value={value}
        memberList={memberList}
        onChange={setPermission}
        onMemberSelect={setValue}
      />
    </>
  )
}
async function setup(props: Options = {}, rbacEnabled = false) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1', name: 'Current User', email: 'current@example.com' },
    systemFeatures: { rbac_enabled: rbacEnabled },
  })
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common, datasetSettings } },
    keySeparator: false,
  })
  const content = (next: Options) => (
    <Wrapper>
      <I18nextProvider i18n={i18n}>
        <ControlledSelector {...next} />
      </I18nextProvider>
    </Wrapper>
  )
  const screen = await render(content(props))
  return { screen, rerender: (next: Options) => screen.rerender(content(next)) }
}

it('keeps the visibility and selected members in the field name across close and reopen', async () => {
  const { screen } = await setup()
  const onlyMe = screen.getByRole('button', { name: 'Knowledge permission Only me' })
  await expect.element(onlyMe).toHaveAccessibleDescription('Choose who can read this knowledge.')
  await onlyMe.click()
  await screen.getByRole('radio', { name: 'All team members', exact: true }).click()
  const all = screen.getByRole('button', { name: 'Knowledge permission All team members' })
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(all).toHaveFocus()
  await all.click()
  await expect
    .element(screen.getByRole('radio', { name: 'All team members', exact: true }))
    .toBeChecked()
  await screen.getByRole('radio', { name: 'Partial team members', exact: true }).click()
  const john = screen.getByRole('button', { name: 'John Doe john@example.com' })
  await expect.element(john).toHaveAttribute('aria-pressed', 'false')
  await john.click()
  await expect.element(john).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  const partial = screen.getByRole('button', {
    name: 'Knowledge permission Current User, John Doe',
  })
  await expect.element(partial).toHaveFocus()
  await expect.element(partial).toHaveAccessibleDescription('Choose who can read this knowledge.')
  await partial.click()
  await expect.element(john).toHaveAttribute('aria-pressed', 'true')
  await john.click()
  await expect.element(john).toHaveAttribute('aria-pressed', 'false')
  await john.click()
  await expect.element(john).toHaveAttribute('aria-pressed', 'true')
  await screen.getByRole('radio', { name: 'Only me', exact: true }).click()
  await expect.element(onlyMe).toHaveFocus()
  await onlyMe.click()
  await screen.getByRole('radio', { name: 'Partial team members', exact: true }).click()
  await expect.element(john).toHaveAttribute('aria-pressed', 'false')
})

it('freezes an open picker when disabled and retains selection until it is unlocked', async () => {
  const props = { permission: PermissionLevel.partialMembers, value: ['user-1', 'user-2'] }
  const { screen, rerender } = await setup(props)
  await screen.getByRole('button', { name: /Knowledge permission Current User/ }).click()
  const john = screen.getByRole('button', { name: 'John Doe john@example.com' })
  const onlyMe = screen.getByRole('radio', { name: 'Only me', exact: true })
  const search = screen.getByRole('searchbox', { name: 'Search', exact: true })
  await rerender({ ...props, disabled: true })
  await expect.element(john).toBeDisabled()
  await expect.element(onlyMe).toBeDisabled()
  await expect.element(search).toBeDisabled()
  await expect.element(john).toHaveAttribute('aria-pressed', 'true')
  await expect.element(screen.getByRole('radio', { name: 'Partial team members' })).toBeChecked()
  await rerender({ ...props, disabled: false })
  await john.click()
  await expect.element(john).toHaveAttribute('aria-pressed', 'false')
  await onlyMe.click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Knowledge permission Only me' }))
    .toHaveFocus()
})

it('allows member edits while visibility changes are locked', async () => {
  const { screen } = await setup({
    permission: PermissionLevel.partialMembers,
    permissionChangeDisabled: true,
  })
  await screen.getByRole('button', { name: 'Knowledge permission Current User' }).click()
  const onlyMe = screen.getByRole('radio', { name: 'Only me', exact: true })
  await expect.element(onlyMe).toBeDisabled()
  await expect.element(screen.getByRole('radio', { name: 'Partial team members' })).toBeChecked()
  const john = screen.getByRole('button', { name: 'John Doe john@example.com' })
  await john.click()
  await expect.element(john).toHaveAttribute('aria-pressed', 'true')
  await userEvent.keyboard('{Escape}')
  await expect
    .element(screen.getByRole('button', { name: 'Knowledge permission Current User, John Doe' }))
    .toHaveFocus()
})

it('updates visibility with arrow navigation without closing the popover', async () => {
  const { screen } = await setup()
  await screen.getByRole('button', { name: 'Knowledge permission Only me' }).click()
  const onlyMe = screen.getByRole('radio', { name: 'Only me', exact: true })
  await expect.element(onlyMe).toBeVisible()
  onlyMe.element().focus()
  await userEvent.keyboard('{ArrowDown}')
  const all = screen.getByRole('radio', { name: 'All team members', exact: true })
  await expect.element(all).toHaveFocus()
  await expect.element(all).toBeChecked()
  await expect
    .element(screen.getByRole('dialog', { name: 'Permissions', exact: true }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Knowledge permission All team members' }))
    .toHaveFocus()
})

it('filters members, shows an empty result and clears back to the full list', async () => {
  const { screen } = await setup({ permission: PermissionLevel.partialMembers })
  await screen.getByRole('button', { name: 'Knowledge permission Current User' }).click()
  const search = screen.getByRole('searchbox', { name: 'Search', exact: true })
  await search.fill('Jane')
  const john = screen.getByRole('button', { name: 'John Doe john@example.com' })
  await expect.element(john).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Jane Smith jane@example.com' }))
    .toBeVisible()
  await search.fill('Nobody')
  await expect.element(screen.getByText(/No members match your search query/)).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Jane Smith jane@example.com' }))
    .not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect.element(search).toHaveValue('')
  await expect.element(john).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Jane Smith jane@example.com' }))
    .toBeVisible()
})

it.each([
  { reason: 'readonly settings', props: { disabled: true }, rbac: false, value: 'Only me' },
  {
    reason: 'RBAC access configuration',
    props: {},
    rbac: true,
    value: 'Go to access configuration',
  },
])('prevents opening from $reason', async ({ props, rbac, value }) => {
  const { screen } = await setup(props, rbac)
  const trigger = screen.getByRole('button', { name: `Knowledge permission ${value}` })
  await expect.element(trigger).toBeDisabled()
  await userEvent.tab()
  await expect.element(trigger).not.toHaveFocus()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('allows the caller to handle RBAC and opens permission editing', async () => {
  const { screen } = await setup({ disableWhenRbacEnabled: false, invalid: true }, true)
  const trigger = screen.getByRole('button', { name: 'Knowledge permission Only me' })
  await expect.element(trigger).toHaveAttribute('aria-invalid', 'true')
  await trigger.click()
  await expect
    .element(screen.getByRole('dialog', { name: 'Permissions', exact: true }))
    .toBeVisible()
})
