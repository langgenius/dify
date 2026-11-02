import type { SlashCommand } from './types'

/**
 * Account command - Navigates to account page
 */
export const accountCommand: SlashCommand = {
  name: 'account',
  description: 'Navigate to account page',
  mode: 'direct',

  execute: (_args, context) => context.navigate('/account'),

  search(args: string, context) {
    return [
      {
        id: 'account',
        title: context.t(($) => $['account.account'], {
          ns: 'accountSettings',
          lng: context.locale,
        }),
        description: context.t(($) => $['gotoAnything.actions.accountDesc'], {
          ns: 'app',
          lng: context.locale,
        }),
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className="i-ri-user-3-line size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'account', args: {} },
      },
    ]
  },
}
