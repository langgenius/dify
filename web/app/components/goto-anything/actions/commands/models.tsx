import type { SlashCommand } from './types'

export const SYSTEM_MODELS_PATH = '/integrations/model-provider?dialog=system-models'

export const modelsCommand: SlashCommand = {
  name: 'models',
  description: 'Configure default workspace models',
  mode: 'direct',

  execute: (_args, context) => context.navigate(SYSTEM_MODELS_PATH),

  search(args: string, context) {
    return [
      {
        id: 'models',
        title: context.t(($) => $['modelProvider.systemModelSettings'], {
          ns: 'modelProvider',
          lng: context.locale,
        }),
        description: context.t(($) => $['modelProvider.systemModelSettingsDesc'], {
          ns: 'modelProvider',
          lng: context.locale,
        }),
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className="i-ri-brain-2-line size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'models' },
      },
    ]
  },
}
