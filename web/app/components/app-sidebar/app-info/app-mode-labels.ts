import type { TFunction } from 'i18next'

export function getAppModeLabel(mode: string, t: TFunction<['app']>): string {
  switch (mode) {
    case 'advanced-chat':
      return t(($) => $['types.advanced'], { ns: 'app' })
    case 'agent-chat':
      return t(($) => $['types.agent'], { ns: 'app' })
    case 'chat':
      return t(($) => $['types.chatbot'], { ns: 'app' })
    case 'completion':
      return t(($) => $['types.completion'], { ns: 'app' })
    default:
      return t(($) => $['types.workflow'], { ns: 'app' })
  }
}
