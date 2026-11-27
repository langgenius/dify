import type { ContactImProviderDefinition } from './types'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { ContactImProvider, ContactImProviderField } from './types'

const setupGuidePaths: Record<Exclude<ContactImProvider, 'resend'>, DocPathWithoutLang> = {
  slack: '/use-dify/workspace/channels/slack',
  feishu: '/use-dify/workspace/channels/feishu-lark',
  lark: '/use-dify/workspace/channels/feishu-lark',
  ding_talk: '/use-dify/workspace/channels/dingtalk',
  ms_teams: '/use-dify/workspace/channels/ms-teams',
  we_com: '/use-dify/workspace/channels/wecom',
}

type ContactImCallbackSetup = {
  consoleUrl: string
  instructionsKey: 'feishu' | 'lark' | 'slack' | 'teams'
}

export const resolveContactImCallbackSetup = (
  provider: Exclude<ContactImProvider, 'resend'>,
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

  return {
    setupGuidePath: setupGuidePaths[definition.provider],
    fields: definition.requiredFields.map((field) => ({
      ...field,
      secret: field.secret || field.field === ContactImProviderField.Secret,
    })),
  }
}
