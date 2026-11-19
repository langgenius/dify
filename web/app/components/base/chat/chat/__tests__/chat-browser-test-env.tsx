import type { ReactElement } from 'react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import dataset from '@/i18n/locales/en-US/dataset.json'
import share from '@/i18n/locales/en-US/share.json'
import tools from '@/i18n/locales/en-US/tools.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'

export async function renderChat(ui: ReactElement) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common, dataset, share, tools, workflow } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { wrapper: ConsoleProvider, queryClient } = createConsoleQueryWrapper()
  const wrap = (content: ReactElement) => (
    <ConsoleProvider>
      <I18nextProvider i18n={i18n}>{content}</I18nextProvider>
    </ConsoleProvider>
  )
  const screen = await render(wrap(ui))
  return {
    ...screen,
    queryClient,
    rerender: (content: ReactElement) => screen.rerender(wrap(content)),
  }
}
