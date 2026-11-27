import type { demoMessages } from './playback-script'
import { useTranslation } from 'react-i18next'
import { demoUsers } from './demo-users'

/** A demo message as posted, with its @mention in front. */
export function useMessageContent() {
  const { t } = useTranslation(['collaborationDemo'])
  return (message: (typeof demoMessages)[number]) =>
    `${message.mention ? `@${demoUsers[message.mention].name} ` : ''}${t(($) => $[`messages.${message.id}`])}`
}
