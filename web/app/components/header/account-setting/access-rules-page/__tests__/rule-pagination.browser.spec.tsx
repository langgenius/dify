import type { consoleClient } from '@/service/console'
import { consoleQuery } from '@/service/console'
import { createDeferred } from '@/test/deferred'
import { renderAccessRule, ruleFor, rulePage } from './access-rule-fixture'

const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.workspaces.current.rbac.workspace.datasets.accessPolicy.get>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.workspace.datasets.accessPolicy.get': api.list,
    }),
  }
})

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
  api.list
    .mockReset()
    .mockImplementation(async (input) =>
      input?.query?.page === 2 ? pending.promise : rulePage(first, 1, 2, 21),
    )
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
  expect(api.list.mock.calls.filter(([input]) => input?.query?.page === 2)).toHaveLength(1)
  pending.resolve(rulePage([next], 2, 2, 21))
  await expect.element(screen.getByText('Next page rule', { exact: true })).toBeInTheDocument()
  await expect.element(screen.getByText('Dataset 1', { exact: true })).toBeInTheDocument()
  await expect
    .element(screen.getByRole('progressbar', { name: 'common.loading' }))
    .not.toBeInTheDocument()
})

it('loads the next page after an active refresh has updated the first page', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => {
    const rule = ruleFor('dataset', `Original ${index + 1}`)
    rule.policy.id = `rule-${index + 1}`
    return rule
  })
  const lastRule = firstPage.at(-1)!
  const updated = {
    ...lastRule,
    policy: { ...lastRule.policy, name: 'Refreshed last rule' },
  }
  const next = ruleFor('dataset', 'Next page rule')
  const refresh = createDeferred<ReturnType<typeof rulePage>>()
  api.list
    .mockReset()
    .mockImplementationOnce(async () => rulePage(firstPage, 1, 2, 21))
    .mockImplementation(async (input) =>
      input?.query?.page === 2 ? rulePage([next], 2, 2, 21) : refresh.promise,
    )
  const { screen, queryClient } = await renderAccessRule('dataset', false)
  onTestFinished(() => queryClient.clear())
  await screen.getByRole('button', { name: /^permission.accessRule.datasetTitle/ }).click()
  const last = screen.getByText(lastRule.policy.name, { exact: true })
  await expect.element(last).toBeInTheDocument()
  const fetching = queryClient.invalidateQueries({
    queryKey: consoleQuery.workspaces.current.rbac.workspace.datasets.accessPolicy.get.key(),
  })
  await expect.poll(() => api.list.mock.calls.length).toBe(2)
  last.element().scrollIntoView()
  await expect.element(last).toBeVisible()

  refresh.resolve(rulePage([...firstPage.slice(0, -1), updated], 1, 2, 21))
  await fetching
  await expect.element(screen.getByText(updated.policy.name, { exact: true })).toBeInTheDocument()
  await expect.element(screen.getByText(next.policy.name, { exact: true })).toBeInTheDocument()
  expect(api.list.mock.calls.map(([input]) => input?.query?.page)).toEqual([1, 1, 2])
})
