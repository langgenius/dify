import type { DifyWorld } from '../../support/world.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, request } from '@playwright/test'
import { createConsoleClient } from '../../../support/api/console-client.ts'
import { apiURL } from '../../../test-env.ts'

const inviteePassword = 'E2eInvitee12345'

const inviteToWorkspace = async (world: DifyWorld, email: string) => {
  const client = world.getConsoleClient()
  const response = await client.workspaces.current.members.inviteEmail.post({
    body: { emails: [email], role: 'normal' },
  })
  const invitation = response.invitation_results[0]
  if (invitation?.status !== 'success')
    throw new Error(`Inviting ${email} did not succeed: ${JSON.stringify(response)}`)

  const url = new URL(invitation.url)
  return { email, path: `${url.pathname}${url.search}`, token: url.searchParams.get('token')! }
}

const removeFromWorkspace = async (world: DifyWorld, email: string) => {
  const client = world.getConsoleClient()
  const { accounts } = await client.workspaces.current.members.get()
  const member = accounts.find((account) => account.email === email)
  if (member)
    await client.workspaces.current.members.byMemberId.delete({ params: { member_id: member.id } })
}

Given(
  'the default E2E admin has invited a person without an account',
  async function (this: DifyWorld) {
    const email = `e2e-invitee-${randomUUID()}@example.com`

    this.registerCleanup(() => removeFromWorkspace(this, email))
    this.workspaceInvitation = await inviteToWorkspace(this, email)
  },
)

Given(
  'the default E2E admin has invited a person who already has an account',
  async function (this: DifyWorld) {
    const email = `e2e-invitee-${randomUUID()}@example.com`
    this.registerCleanup(() => removeFromWorkspace(this, email))

    // Accept a first invitation over the API so the account exists with a password, then remove
    // the membership and invite the same person again.
    const first = await inviteToWorkspace(this, email)
    const inviteeContext = await request.newContext({ baseURL: apiURL })
    try {
      const invitee = createConsoleClient({
        requestContext: inviteeContext,
        requireCsrfToken: false,
      })
      await invitee.login.post({
        body: {
          email,
          password: Buffer.from(inviteePassword).toString('base64'),
          invite_token: first.token,
        },
      })
      await invitee.activate.post({
        body: {
          token: first.token,
          name: 'E2E Invitee',
          interface_language: 'en-US',
          timezone: 'UTC',
        },
      })
    } finally {
      await inviteeContext.dispose()
    }
    await removeFromWorkspace(this, email)

    this.workspaceInvitation = await inviteToWorkspace(this, email)
  },
)

When('I open the workspace invitation', async function (this: DifyWorld) {
  if (!this.workspaceInvitation) throw new Error('No workspace invitation was prepared.')

  await this.getPage().goto(this.workspaceInvitation.path)
})

Then('I should be asked to create an account', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByRole('button', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByLabel('New password')).toBeEditable()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0)
  await expect(page.getByText('Forgot your password?')).toHaveCount(0)
})

Then('I should be asked to sign in', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeEditable()
  await expect(page.getByRole('button', { name: 'Create your account' })).toHaveCount(0)
})

When('I create my account with a new password', async function (this: DifyWorld) {
  const page = this.getPage()

  await page.getByLabel('New password').fill(inviteePassword)
  await page.getByRole('button', { name: 'Create your account' }).click()
})

When('I sign in with my existing password', async function (this: DifyWorld) {
  const page = this.getPage()

  await page.getByLabel('Password', { exact: true }).fill(inviteePassword)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
})

When('I set my name and join the workspace', async function (this: DifyWorld) {
  const page = this.getPage()
  const name = page.getByLabel('Username')

  await expect(name).toBeEditable()
  await name.fill('E2E Invitee')
  await page.getByRole('button', { name: /^Join / }).click()
})

When('I join the workspace', async function (this: DifyWorld) {
  const page = this.getPage()
  const join = page.getByRole('button', { name: /^Join / })

  await expect(join).toBeEnabled()
  await join.click()
})
