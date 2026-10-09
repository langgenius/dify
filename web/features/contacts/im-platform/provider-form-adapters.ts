import type { ContactImProviderDefinition } from './types'
import { ContactImAuthMode, ContactImProvider, ContactImProviderField } from './types'

const setupGuideUrls: Record<Exclude<ContactImProvider, 'email'>, string> = {
  slack: 'https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests/',
  feishu:
    'https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process',
  lark: 'https://open.larksuite.com/document/home/introduction-to-custom-app-development/self-built-application-development-process',
  dingtalk: 'https://open.dingtalk.com/document/',
  ms_teams:
    'https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-register-aad',
  we_com: 'https://developer.work.weixin.qq.com/document/path/90665',
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
