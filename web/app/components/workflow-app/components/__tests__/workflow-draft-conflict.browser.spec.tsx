import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import translations from '@/i18n/locales/fr-FR/workflow.json'
import { consoleQuery } from '@/service/console'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import WorkflowDraftConflict from '../workflow-draft-conflict'

const { fetchDraft } = vi.hoisted(() => ({ fetchDraft: vi.fn() }))

vi.mock('@/service/workflow', () => ({ fetchWorkflowDraft: fetchDraft }))
vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: workflow } = await import('@/i18n/locales/fr-FR/workflow.json')
  return createReactI18nextMock(workflow)
})

it('keeps the discard choice readable and makes Enter defer an automatically opened conflict', async () => {
  // Real layout catches clipping of the destructive action's long label. Native
  // Enter verifies that an automatically opened conflict cannot discard by default.
  await page.viewport(320, 640)
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({ id: 'app-1', mode: 'workflow' }),
  )
  const atoms = createStore()
  atoms.set(editorResourceAtom, { kind: 'app', appId: 'app-1', mode: 'workflow' })
  const store = createWorkflowStore({})
  store.getState().setWorkflowDraftConflict(true)
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <Provider store={atoms}>
        <WorkflowContext value={store}>
          <WorkflowDraftConflict />
        </WorkflowContext>
      </Provider>
    </QueryClientProvider>,
  )
  const dialog = screen.getByRole('alertdialog', { name: translations['draftConflict.title'] })
  const defer = dialog.getByRole('button', { name: translations['draftConflict.cancel'] })
  await expect.element(defer).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).not.toBeInTheDocument()
  expect(fetchDraft).not.toHaveBeenCalled()
  expect(store.getState().hasWorkflowDraftConflict).toBe(true)

  await screen.getByRole('button', { name: translations['draftConflict.resolve'] }).click()
  const discard = dialog.getByRole('button', { name: translations['draftConflict.confirmReload'] })
  await expect.element(discard).toBeVisible()
  const button = discard.element()
  expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth)
  expect(button.scrollHeight).toBeLessThanOrEqual(button.clientHeight)
  const bounds = button.getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
})
