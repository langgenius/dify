import { createCommand } from '../create'
import { createCommandContext } from './context'

let context = createCommandContext()
describe('/create slash command', () => {
  beforeEach(() => {
    context = createCommandContext()
  })

  describe('search()', () => {
    it('should surface auto, workflow and chatflow when args is empty', async () => {
      const results = await createCommand.search('', context)
      expect(results.map((r) => r.id)).toEqual([
        'create-auto',
        'create-workflow',
        'create-chatflow',
      ])
      expect(results[0]!.data.args).toEqual({ mode: 'advanced-chat', auto: true, instruction: '' })
    })

    it('should filter by query and attach the right command payload', async () => {
      const results = await createCommand.search('chat', context)
      expect(results.map((r) => r.id)).toEqual(['create-chatflow'])
      expect(results[0]!.data.command).toBe('create')
      expect(results[0]!.data.args).toEqual({ mode: 'advanced-chat', auto: false, instruction: '' })
    })

    it('should return an empty list when a single-token query matches nothing', async () => {
      const results = await createCommand.search('zzz', context)
      expect(results).toEqual([])
    })

    it('should filter by the localised label, not just the id', async () => {
      const results = await createCommand.search('createChatflow', context)
      expect(results.map((r) => r.id)).toEqual(['create-chatflow'])
    })

    it('should capture a trailing instruction when the first word names a mode', async () => {
      const results = await createCommand.search('workflow summarize a URL', context)
      expect(results.map((r) => r.id)).toEqual(['create-workflow'])
      expect(results[0]!.data.args).toEqual({
        mode: 'workflow',
        auto: false,
        instruction: 'summarize a URL',
      })
      expect(results[0]!.description).toBe('summarize a URL')
      await createCommand.execute(results[0]!.data.args!, context)
      expect(context.openGenerator).toHaveBeenCalledWith({
        mode: 'workflow',
        autoMode: false,
        initialInstruction: 'summarize a URL',
      })
    })

    it('should keep all options with the full text when no leading mode word', async () => {
      const results = await createCommand.search('summarize a URL', context)
      expect(results.map((r) => r.id)).toEqual([
        'create-auto',
        'create-workflow',
        'create-chatflow',
      ])
      results.forEach((r) => {
        expect(r.data.args).toMatchObject({ instruction: 'summarize a URL' })
      })
    })
  })

  describe('execute()', () => {
    it('should open the generator with the requested mode when no Studio app is open', async () => {
      await createCommand.execute({ mode: 'workflow' }, context)

      expect(context.openGenerator).toHaveBeenCalledWith({
        mode: 'workflow',
        autoMode: false,
        initialInstruction: '',
      })
    })

    it('should open new-app auto-mode even when a matching Studio app is open', async () => {
      context.currentApp = { id: 'abc-123', mode: 'advanced-chat' }

      await createCommand.execute({ mode: 'advanced-chat', auto: true }, context)

      expect(context.openGenerator).toHaveBeenCalledWith({
        mode: 'advanced-chat',
        autoMode: true,
        initialInstruction: '',
      })
    })

    it('should thread the current app context when a matching Studio app is open', async () => {
      context.currentApp = { id: 'abc-123', mode: 'workflow' }

      await createCommand.execute({ mode: 'workflow' }, context)

      expect(context.openGenerator).toHaveBeenCalledWith({
        mode: 'workflow',
        currentAppId: 'abc-123',
        currentAppMode: 'workflow',
        initialInstruction: '',
      })
    })

    it('should fall back to new-app only when the picked mode differs from the open app', async () => {
      context.currentApp = { id: 'abc-123', mode: 'workflow' }

      await createCommand.execute({ mode: 'advanced-chat' }, context)

      expect(context.openGenerator).toHaveBeenCalledWith({
        mode: 'advanced-chat',
        autoMode: false,
        initialInstruction: '',
      })
    })
  })
})
