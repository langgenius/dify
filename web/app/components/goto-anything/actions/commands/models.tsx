import type { SlashCommand } from './types'
import { systemModelDialog } from '@/app/components/header/account-setting/model-provider-page/system-model-selector/handle'

export const modelsCommand: SlashCommand = {
  name: 'models',
  description: 'Configure default workspace models',
  mode: 'direct',

  isAvailable: (context) => context.canConfigureModels,

  execute: () => systemModelDialog.open(null),

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
