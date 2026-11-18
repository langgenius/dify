import { createDeferred } from '@/test/deferred'
import { installFakeApi } from '@/test/fake-api'
import { renderAccessRule, ruleFor, rulePage } from './access-rule-fixture'

it('loads the next rules at the expanded list boundary and preserves the first page while it is pending', async () => {
  const first = Array.from({ length: 20 }, (_, index) => {
    const rule = ruleFor('dataset', `Dataset ${index + 1}`)
    rule.policy.id = `rule-${index + 1}`
    rule.policy.description = ''
    return rule
  })
  const next = ruleFor('dataset', 'Next page rule')
  next.policy.id = 'next-page'
  const pending = createDeferred<ReturnType<typeof rulePage>>()
  const fake = installFakeApi({
    console: {
      workspaces: {
        current: {
          rbac: {
            workspace: {
              datasets: {
                accessPolicy: {
                  get: async (input) =>
                    input?.query?.page === 2 ? pending.promise : rulePage(first, 1, 2, 21),
                },
              },
            },
          },
        },
      },
    },
  })
  onTestFinished(fake)
  const { screen, queryClient } = await renderAccessRule('dataset', false)
  onTestFinished(() => queryClient.clear())
  const trigger = screen.getByRole('button', { name: /^permission.accessRule.datasetTitle/ })
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect
    .element(screen.getByText(/^permission.accessRule.summary/))
    .toMatchTextContent('"count":21')
  await expect.element(screen.getByText('Dataset 1', { exact: true })).not.toBeInTheDocument()
  await trigger.click()
  await expect.element(screen.getByText('Dataset 1', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('permission.accessRule.noDescription').nth(0)).toBeVisible()
  await expect
    .element(screen.getByText(/^permission.accessRule.summary/))
    .toMatchTextContent('"count":21')
  const last = screen.getByText('Dataset 20', { exact: true })
  await expect.element(last).toBeInTheDocument()
  last.element().scrollIntoView()
  await expect.element(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  const beginning = screen.getByText('Dataset 1', { exact: true })
  beginning.element().scrollIntoView()
  await expect.element(beginning).toBeVisible()
  last.element().scrollIntoView()
  await expect.element(last).toBeVisible()
  await expect.element(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  expect(
    fake.console.workspaces.current.rbac.workspace.datasets.accessPolicy.get.mock.calls.filter(
      ([input]) => input?.query?.page === 2,
    ),
  ).toHaveLength(1)
  pending.resolve(rulePage([next], 2, 2, 21))
  await expect.element(screen.getByText('Next page rule', { exact: true })).toBeInTheDocument()
  await expect.element(screen.getByText('Dataset 1', { exact: true })).toBeInTheDocument()
  await expect
    .element(screen.getByRole('progressbar', { name: 'common.loading' }))
    .not.toBeInTheDocument()
})
