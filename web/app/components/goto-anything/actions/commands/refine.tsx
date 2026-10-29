import type { SlashCommand } from './types'

export const refineCommand: SlashCommand = {
  name: 'refine',
  aliases: ['improve'],
  description: 'Refine the current app',
  mode: 'direct',

  // Only surface inside a Workflow / Advanced-Chat Studio — elsewhere there's
  // no draft graph to refine.
  isAvailable: (context) => context.currentApp !== null,

  execute(_args, context) {
    const app = context.currentApp
    if (!app) return
    context.openGenerator({
      intent: 'refine',
      mode: app.mode,
      currentAppId: app.id,
      currentAppMode: app.mode,
    })
  },

  search(_args: string, context) {
    return [
      {
        id: 'refine-current',
        title: context.t(($) => $['gotoAnything.actions.refineTitle'], {
          ns: 'app',
          lng: context.locale,
        }),
        description: context.t(($) => $['gotoAnything.actions.refineDesc'], {
          ns: 'app',
          lng: context.locale,
        }),
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className="i-ri-sparkling-2-line size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'refine', args: {} },
      },
    ]
  },
}
