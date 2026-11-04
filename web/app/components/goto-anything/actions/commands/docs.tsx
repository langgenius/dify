import type { SlashCommand } from './types'

/**
 * Documentation command - Opens help documentation
 */
export const docsCommand: SlashCommand = {
  name: 'docs',
  description: 'Open documentation',
  mode: 'direct',

  execute: (_args, context) => context.openExternal(context.getDocsHomeUrl()),

  search(args: string, context) {
    return [
      {
        id: 'doc',
        title: context.t(($) => $['userProfile.helpCenter'], { ns: 'common', lng: context.locale }),
        description:
          context.t(($) => $['gotoAnything.actions.docDesc'], { ns: 'app', lng: context.locale }) ||
          'Open help documentation',
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className="i-ri-book-open-line size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'docs', args: {} },
      },
    ]
  },
}
