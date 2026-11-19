import type { ReactElement } from 'react'
import type { UserProfileWithMeta } from '@/features/account-profile/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import appDebug from '@/i18n/locales/en-US/app-debug.json'
import appLog from '@/i18n/locales/en-US/app-log.json'
import common from '@/i18n/locales/en-US/common.json'
import runLog from '@/i18n/locales/en-US/run-log.json'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createConsoleQueryWrapper } from '@/test/console/query-data'

export async function renderAgentLog(ui: ReactElement) {
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
  const accountProfile = seedAccountProfileQuery(queryClient)
  queryClient.setQueryData<UserProfileWithMeta>(
    consoleQuery.account.profile.get.queryKey(),
    accountProfile,
  )
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { appDebug, appLog, common, runLog } },
    keySeparator: false,
  })
  const view = (content: ReactElement) => (
    <QueryProvider>
      <I18nextProvider i18n={i18n}>
        {content}
        <AppToaster timeout={0} />
      </I18nextProvider>
    </QueryProvider>
  )
  const screen = await render(view(ui))
  return {
    queryClient,
    screen,
    rerender: (next: ReactElement) => screen.rerender(view(next)),
  }
}
