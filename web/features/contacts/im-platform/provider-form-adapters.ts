import type { ContactImProviderDefinition } from './types'
import { ContactImAuthMode, ContactImProvider, ContactImProviderField } from './types'

const setupGuideUrls: Record<Exclude<ContactImProvider, 'email'>, string> = {
  slack: 'https://docs.slack.dev/interactivity/handling-user-interaction/',
  feishu:
    'https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/callback-subscription/callback-overview',
  lark: 'https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/callback-subscription/callback-overview',
  dingtalk: 'https://open.dingtalk.com/document/',
  ms_teams:
    'https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-register-aad',
  we_com: 'https://developer.work.weixin.qq.com/document/path/90665',
}

type ContactImCallbackSetup = {
  consoleUrl: string
  instructionsKey: 'feishu' | 'lark' | 'slack' | 'teams'
}

export const resolveContactImCallbackSetup = (
  provider: Exclude<ContactImProvider, 'email'>,
): ContactImCallbackSetup | null => {
  switch (provider) {
    case ContactImProvider.Feishu:
    case ContactImProvider.Lark: {
      const origin =
        provider === ContactImProvider.Feishu
          ? 'https://open.feishu.cn'
          : 'https://open.larksuite.com'
      return {
        consoleUrl: `${origin}/app`,
        instructionsKey: provider,
      }
    }
    case ContactImProvider.Slack:
      return {
        consoleUrl: 'https://api.slack.com/apps',
        instructionsKey: 'slack',
      }
    case ContactImProvider.MSTeams:
      return {
        consoleUrl: 'https://portal.azure.com/#browse/Microsoft.BotService%2FbotServices',
        instructionsKey: 'teams',
      }
    case ContactImProvider.DingTalk:
    case ContactImProvider.WeCom:
      return null
  }
}

export const resolveContactImProviderFormAdapter = (definition: ContactImProviderDefinition) => {
  if (definition.provider === ContactImProvider.Email)
    throw new Error('Email uses its dedicated configuration form')
  if (definition.authMode !== ContactImAuthMode.Credentials)
    throw new Error(`Provider requires application credentials: ${definition.provider}`)

  return {
    setupGuideUrl: setupGuideUrls[definition.provider],
    fields: definition.requiredFields.map((field) => ({
      ...field,
      secret: field.secret || field.field === ContactImProviderField.Secret,
    })),
  }
}
