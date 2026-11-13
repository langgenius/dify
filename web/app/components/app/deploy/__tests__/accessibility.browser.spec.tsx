import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { userEvent } from 'vite-plus/test/browser'
import {
  checkAccessibility,
  checkMenuAccessibility,
  deployment,
  environment,
  renderDeploy,
} from './accessibility-test-env'

vi.unmock('react-i18next')

// boundary: isolated Browser specs do not provide the Next route params runtime.
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'deploy-audit' }),
}))

it('verifies every reported menu sentinel redirects focus and allows keyboard exit in both directions', async () => {
  const screen = await renderDeploy()
  const trigger = screen.getByRole('button', { name: 'Deploy', exact: true })
  const openDeployMenu = async () => {
    trigger.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('menuitem', { name: 'Dev', exact: true })).toHaveFocus()
  }
  await checkMenuAccessibility(openDeployMenu)
  await openDeployMenu()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(trigger).toHaveFocus()
  await openDeployMenu()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: 'Release 0', exact: true })).toHaveFocus()

  const more = screen.getByRole('button', { name: 'Canary · More actions', exact: true })
  await checkMenuAccessibility(async () => {
    more.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('menu')).toBeVisible()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('keeps focus through the first lazy menu handoff and resets deployment drafts before a pointer reopen', async () => {
  const screen = await renderDeploy()
  await checkAccessibility()
  const trigger = screen.getByRole('button', { name: 'Deploy', exact: true })
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const dev = screen.getByRole('menuitem', { name: 'Dev', exact: true })
  await expect.element(dev).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(dev).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Release 0', exact: true })).toHaveFocus()
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dev).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const versions = screen.getByRole('dialog', { name: 'Deploy to Dev', exact: true })
  await expect.element(dev).not.toBeInTheDocument()
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await checkAccessibility()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect
    .element(configuration.getByRole('heading', { name: 'Deploy configuration', exact: true }))
    .toHaveFocus()
  await checkAccessibility()

  await configuration.getByRole('button', { name: 'Deploy', exact: true }).click()
  const credential = configuration.getByRole('combobox', { name: 'Deepseek', exact: true })
  await expect.element(credential).toHaveFocus()
  await expect.element(credential).toHaveAttribute('aria-invalid', 'true')
  await checkAccessibility()
  await credential.click()
  await screen.getByRole('option', { name: 'Production key', exact: true }).click()
  await configuration.getByRole('button', { name: 'Deploy', exact: true }).click()
  const port = configuration.getByRole('spinbutton', { name: 'PORT', exact: true })
  await expect.element(port).toHaveFocus()
  await expect.element(port).toHaveAttribute('aria-invalid', 'true')
  await checkAccessibility()
  await port.fill('3000')
  await userEvent.keyboard('{Escape}')
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()

  await trigger.click()
  await dev.click()
  await expect.element(dev).not.toBeInTheDocument()
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  await expect.element(credential).toBeVisible()
  await expect.element(port).toHaveValue(null)
  await configuration.getByRole('button', { name: 'Deploy', exact: true }).click()
  await expect.element(credential).toHaveAttribute('aria-invalid', 'true')
  await expect.element(credential).toHaveFocus()
  await configuration.getByRole('button', { name: 'Back', exact: true }).click()
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(versions).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})

it('uses the requested version and restores surviving triggers as redeploy and undeploy menu items unmount', async () => {
  const screen = await renderDeploy()
  const latest = screen.getByRole('button', { name: 'Deploy latest', exact: true })
  await latest.click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect.element(configuration.getByText('Release 1', { exact: true })).toBeVisible()
  await configuration.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(latest).toHaveFocus()
  const more = screen.getByRole('button', { name: 'Canary · More actions', exact: true })
  await more.click()
  const redeploy = screen.getByRole('menuitem', { name: 'Redeploy', exact: true })
  await redeploy.click()
  await expect.element(configuration).toBeVisible()
  await expect.element(configuration.getByText('Release 0', { exact: true })).toBeVisible()
  await expect.element(redeploy).not.toBeInTheDocument()
  await expect
    .element(configuration.getByRole('heading', { name: 'Deploy configuration', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'Undeploy', exact: true }))
    .toBeVisible()
  await userEvent.keyboard('{End}')
  const undeploy = screen.getByRole('menuitem', { name: 'Undeploy', exact: true })
  await expect.element(undeploy).toHaveFocus()
  await userEvent.keyboard(' ')
  const confirmation = screen.getByRole('alertdialog')
  await expect.element(confirmation).toBeVisible()
  await expect.element(undeploy).not.toBeInTheDocument()
  await checkAccessibility()
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  await more.click()
  await undeploy.click()
  await expect.element(confirmation).toBeVisible()
  await expect.element(undeploy).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
})

it('returns focus to the environment heading after a successful deployment removes the empty-state trigger', async () => {
  const deployed: EnvironmentDeployment = {
    ...deployment,
    environment: { ...environment, id: 'dev', display_name: 'Dev' },
  }
  const deployRequests: Request[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    if (request.url.endsWith('/deployment:deploy')) {
      deployRequests.push(request.clone())
      return Response.json({
        operation: {
          id: 'deploy-dev',
          status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
          type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
        },
      })
    }
    if (request.url.endsWith('/environments'))
      return Response.json({ data: [{ ...deployed.environment, in_use: true }] })
    if (request.url.endsWith('/workflows/environment-deployments'))
      return Response.json({ environment_deployments: [deployed] })
    throw new Error(`Unexpected request: ${request.method} ${request.url}`)
  })
  const screen = await renderDeploy({ environmentDeployments: [] })
  const emptyDeploy = screen.getByRole('button', { name: 'Deploy', exact: true }).nth(1)
  await emptyDeploy.click()
  await screen.getByRole('menuitem', { name: 'Dev', exact: true }).click()
  const versions = screen.getByRole('dialog', { name: 'Deploy to Dev', exact: true })
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await configuration.getByRole('combobox', { name: 'Deepseek', exact: true }).click()
  await screen.getByRole('option', { name: 'Production key', exact: true }).click()
  await configuration.getByRole('spinbutton', { name: 'PORT', exact: true }).fill('3000')
  await configuration.getByRole('button', { name: 'Deploy', exact: true }).click()
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(screen.getByRole('rowheader', { name: 'Dev', exact: true })).toBeVisible()
  await expect
    .element(screen.getByRole('heading', { name: 'Environments', exact: true }))
    .toHaveFocus()
  expect(deployRequests).toHaveLength(1)
  expect(new URL(deployRequests[0]!.url).pathname).toContain('/environments/dev/deployment:deploy')
})
