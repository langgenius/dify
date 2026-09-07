import type { SlashCommandHandler } from './types'
import { getI18n } from 'react-i18next'
import { registerCommands, unregisterCommands } from './command-bus'

type ModelsDeps = Record<string, never>

export const SYSTEM_MODELS_PATH = '/integrations/model-provider?dialog=system-models'

const openSystemModels = () => {
  window.location.href = SYSTEM_MODELS_PATH
}

export const modelsCommand: SlashCommandHandler<ModelsDeps> = {
  name: 'models',
  description: 'Configure default workspace models',
  mode: 'direct',

  execute: openSystemModels,

  search(_args: string, locale: string = 'en') {
    const i18n = getI18n()
    return [
      {
        id: 'models',
        title: i18n.t(($) => $['modelProvider.systemModelSettings'], {
          ns: 'common',
          lng: locale,
        }),
        description: i18n.t(($) => $['modelProvider.systemModelSettingsDesc'], {
          ns: 'common',
          lng: locale,
        }),
        type: 'command' as const,
        icon: (
          <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
            <span aria-hidden className="i-ri-brain-2-line size-4 text-text-tertiary" />
          </div>
        ),
        data: { command: 'navigation.models' },
      },
    ]
  },

  register(_deps: ModelsDeps) {
    registerCommands({
      'navigation.models': async () => openSystemModels(),
    })
  },

  unregister() {
    unregisterCommands(['navigation.models'])
  },
}
