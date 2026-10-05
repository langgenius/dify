import type {
  GetExploreAppsResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { CreateAppTemplateDialog } from '../index'

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: { call: transport } }))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
}))

const template = (name: string, mode: string, category: string): RecommendedAppResponse => ({
  app_id: `catalog-${name}`,
  app: {
    id: `source-${name}`,
    name,
    mode,
    icon_type: 'emoji',
    icon: '🙂',
    icon_background: '#fff',
    icon_url: null,
  },
  can_trial: false,
  categories: [category],
  description: `${name} description`,
  position: 0,
})
const catalog: GetExploreAppsResponse = {
  recommended_apps: [
    template('Alpha', 'chat', 'Assistant'),
    template('Writer', 'completion', 'Writing'),
    template('Agent', 'agent', 'Assistant'),
  ],
  categories: ['Assistant', 'Writing'],
}

beforeEach(() => {
  transport.mockReset()
  transport.mockImplementation(async (path: string[]) => {
    if (path.join('.') === 'explore.apps.get') return catalog
    throw new Error(`Unexpected request: ${path.join('.')}`)
  })
})

it('loads the real catalog only when opened and discards its search after completed closing', async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  const { rerender } = render(<CreateAppTemplateDialog open={false} onOpenChange={onOpenChange} />)
  expect(transport).not.toHaveBeenCalled()
  rerender(<CreateAppTemplateDialog open onOpenChange={onOpenChange} />)
  await screen.findByTitle('Alpha')
  expect(transport).toHaveBeenCalledWith(
    ['explore', 'apps', 'get'],
    expect.objectContaining({ query: { language: 'en-US' } }),
    expect.anything(),
  )
  expect(screen.queryByTitle('Agent')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Writing' }))
  expect(screen.queryByTitle('Alpha')).not.toBeInTheDocument()
  expect(screen.getByTitle('Writer')).toBeInTheDocument()
  await user.type(screen.getByRole('searchbox'), 'Writ')
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(onOpenChange).toHaveBeenCalledWith(
    false,
    expect.objectContaining({ reason: 'close-press' }),
  )
  rerender(<CreateAppTemplateDialog open={false} onOpenChange={onOpenChange} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  rerender(<CreateAppTemplateDialog open onOpenChange={onOpenChange} />)
  await screen.findByTitle('Alpha')
  expect(screen.getByRole('searchbox')).toHaveValue('')
  expect(screen.getByTitle('Writer')).toBeInTheDocument()
  expect(transport).toHaveBeenCalledTimes(1)
})

it('keeps the real Agent template filter and exposes only the allowed template mode', async () => {
  render(<CreateAppTemplateDialog open onOpenChange={vi.fn()} templateMode="agent" />, {
    workspacePermissionKeys: ['agent.create'],
  })
  await screen.findByTitle('Agent')
  expect(screen.queryByTitle('Alpha')).not.toBeInTheDocument()
  expect(screen.queryByTitle('Writer')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'app.typeSelector.all' })).not.toBeInTheDocument()
})

it('cancels real template naming without requesting details or closing the catalog', async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  render(<CreateAppTemplateDialog open onOpenChange={onOpenChange} />, {
    workspacePermissionKeys: ['app.create_and_management'],
  })
  const useTemplate = await screen.findByRole('button', { name: 'app.newApp.useTemplate Alpha' })
  await user.click(useTemplate)
  const naming = await screen.findByRole('dialog', { name: /explore.appCustomize.title/ })
  await user.type(
    within(naming).getByRole('textbox', { name: 'app.newApp.captionName' }),
    ' changed',
  )
  await user.click(within(naming).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(naming).not.toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: 'app.newApp.startFromTemplate' })).toBeInTheDocument()
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(transport.mock.calls.map(([path]) => path.join('.'))).toEqual(['explore.apps.get'])
})
