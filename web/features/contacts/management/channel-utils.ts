const providerLabels: Record<string, string> = {
  dingtalk: 'DingTalk',
  email: 'Email',
  feishu: 'Feishu',
  slack: 'Slack',
}

export function getContactChannelLabel(provider: string) {
  return providerLabels[provider.toLocaleLowerCase()] ?? provider
}
