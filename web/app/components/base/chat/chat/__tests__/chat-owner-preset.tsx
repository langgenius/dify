import type { ReactNode } from 'react'
import type { ChatItem } from '../../types'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import appAnnotation from '@/i18n/locales/en-US/app-annotation.json'
import appDebug from '@/i18n/locales/en-US/app-debug.json'
import appLog from '@/i18n/locales/en-US/app-log.json'
import common from '@/i18n/locales/en-US/common.json'
import share from '@/i18n/locales/en-US/share.json'
import tools from '@/i18n/locales/en-US/tools.json'
import workflowHumanInput from '@/i18n/locales/en-US/workflow-human-input.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'

export const chatItem = (overrides: Partial<ChatItem> = {}): ChatItem => ({
  id: 'answer-1',
  content: 'An answer',
  isAnswer: true,
  ...overrides,
})

export async function renderChatOwner(ui: ReactNode) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: {
      'en-US': {
        common,
        appDebug,
        appAnnotation,
        appLog,
        agentV2,
        workflow,
        workflowHumanInput,
        share,
        tools,
      },
    },
  })
  const { wrapper: ConsoleWrapper } = createConsoleQueryWrapper()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ConsoleWrapper>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </ConsoleWrapper>
  )
  return render(ui, { wrapper: Wrapper })
}
