import { resolveContactImCallbackSetup } from '../provider-form-adapters'
import { ContactImProvider } from '../types'

describe('channel callback configuration destinations', () => {
  it.each([
    {
      provider: ContactImProvider.Feishu,
      setup: { consoleUrl: 'https://open.feishu.cn/app', instructionsKey: 'feishu' },
    },
    {
      provider: ContactImProvider.Lark,
      setup: { consoleUrl: 'https://open.larksuite.com/app', instructionsKey: 'lark' },
    },
    {
      provider: ContactImProvider.Slack,
      setup: { consoleUrl: 'https://api.slack.com/apps', instructionsKey: 'slack' },
    },
    {
      provider: ContactImProvider.MSTeams,
      setup: {
        consoleUrl: 'https://portal.azure.com/#browse/Microsoft.BotService%2FbotServices',
        instructionsKey: 'teams',
      },
    },
    { provider: ContactImProvider.DingTalk, setup: null },
    { provider: ContactImProvider.WeCom, setup: null },
  ])('routes $provider to its own supported callback setup', ({ provider, setup }) => {
    expect(resolveContactImCallbackSetup(provider)).toEqual(setup)
  })
})
