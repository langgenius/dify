const providerLabels: Record<string, string> = {
  ding_talk: 'DingTalk',
  dingtalk: 'DingTalk',
  email: 'Email',
  feishu: 'Feishu',
  lark: 'Lark',
  ms_teams: 'Microsoft Teams',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  we_com: 'WeCom',
  wecom: 'WeCom',
}

export function getContactChannelLabel(provider: string) {
  return providerLabels[provider.toLocaleLowerCase()] ?? provider
}
