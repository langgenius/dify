import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { ComponentProps } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import CreateAppTemplateDialog from '../index'

const { importApp, push } = vi.hoisted(() => ({ importApp: vi.fn(), push: vi.fn() }))
const template: RecommendedAppResponse = {
  app_id: 'catalog-app',
  app: {
    id: 'nested-app',
    name: 'Template',
    mode: 'chat',
    icon_type: 'emoji',
    icon: '🙂',
    icon_background: '#fff',
    icon_url: null,
  },
  can_trial: false,
  categories: ['Assistant'],
  description: 'Template description',
  position: 0,
}
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push }), useParams: () => ({}) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'explore.apps.get': () => ({ recommended_apps: [template], categories: ['Assistant'] }),
      'explore.apps.byAppId.get': () => ({
        id: 'catalog-app',
        name: 'Template',
        mode: 'chat',
        can_trial: false,
        export_data: 'template-dsl',
      }),
      'apps.imports.post': importApp,
      'apps.imports.byAppId.checkDependencies.get': () => ({ leaked_dependencies: [] }),
    }),
  }
})
beforeEach(() => {
  importApp.mockResolvedValue({
    id: 'import-1',
    status: 'completed',
    app_id: 'created-app',
    app_mode: 'chat',
    permission_keys: ['app.edit'],
  })
})
const setup = (props: Partial<ComponentProps<typeof CreateAppTemplateDialog>> = {}) =>
  render(<CreateAppTemplateDialog show onClose={vi.fn()} {...props} />, {
    workspacePermissionKeys: ['app.create_and_management'],
  })

it('omits create from blank when no callback is available', async () => {
  setup()
  await screen.findByTitle('Template')
  expect(
    screen.queryByRole('button', { name: 'app.newApp.startFromBlank' }),
  ).not.toBeInTheDocument()
})

it('opens the template catalog when shown', async () => {
  const { rerender } = setup({ show: false })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<CreateAppTemplateDialog show onClose={vi.fn()} />)
  expect(await screen.findByTitle('Template')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('closes from the dialog shell close button', async () => {
  const user = userEvent.setup()
  function Scenario() {
    const [show, setShow] = useState(true)
    return <CreateAppTemplateDialog show={show} onClose={() => setShow(false)} />
  }
  render(<Scenario />)
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('imports the selected template with the edited name and closes the picker', async () => {
  const user = userEvent.setup()
  function Scenario() {
    const [show, setShow] = useState(true)
    return <CreateAppTemplateDialog show={show} onClose={() => setShow(false)} />
  }
  render(<Scenario />, { workspacePermissionKeys: ['app.create_and_management'] })
  await user.click(await screen.findByRole('button', { name: /^app.newApp.useTemplate/ }))
  const name = screen.getByRole('textbox', { name: 'app.newApp.name' })
  await user.clear(name)
  await user.type(name, 'My assistant')
  await user.click(screen.getByRole('button', { name: /common.operation.create/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(importApp).toHaveBeenCalledExactlyOnceWith({
    body: expect.objectContaining({ name: 'My assistant', yaml_content: 'template-dsl' }),
  })
})

it('offers the caller create-from-blank action through the real sidebar', async () => {
  const user = userEvent.setup()
  function Scenario() {
    const [blank, setBlank] = useState(false)
    return blank ? (
      <p>Blank app form</p>
    ) : (
      <CreateAppTemplateDialog show onClose={vi.fn()} onCreateFromBlank={() => setBlank(true)} />
    )
  }
  render(<Scenario />)
  await user.click(await screen.findByRole('button', { name: 'app.newApp.startFromBlank' }))
  expect(screen.getByText('Blank app form')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
