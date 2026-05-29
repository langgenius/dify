import { createCommand } from '../../app/components/goto-anything/actions/commands/create'

// The icons in create.tsx are React components; tests don't need to render them.
vi.mock('@remixicon/react', () => ({
  RiChat3Line: () => null,
  RiNodeTree: () => null,
}))

vi.mock('@/app/components/workflow/workflow-generator/store', () => ({
  useWorkflowGeneratorStore: { getState: vi.fn(() => ({ openGenerator: vi.fn() })) },
}))

describe('/create slash command', () => {
  it('exposes a submenu mode', () => {
    expect(createCommand.mode).toBe('submenu')
    expect(createCommand.name).toBe('create')
  })

  it('surfaces both workflow and chatflow when args is empty', async () => {
    const results = await createCommand.search('')
    expect(results.map(r => r.id)).toEqual(['create-workflow', 'create-chatflow'])
  })

  it('filters by query when args is provided', async () => {
    const results = await createCommand.search('chat')
    expect(results.map(r => r.id)).toEqual(['create-chatflow'])
    expect(results[0]!.data.command).toBe('create.open')
    expect(results[0]!.data.args).toEqual({ mode: 'advanced-chat' })
  })

  it('returns an empty list when the query matches nothing', async () => {
    const results = await createCommand.search('zzz-no-match')
    expect(results).toEqual([])
  })

  it('declares "new" and "generate" as aliases', () => {
    expect(createCommand.aliases).toEqual(['new', 'generate'])
  })
})
