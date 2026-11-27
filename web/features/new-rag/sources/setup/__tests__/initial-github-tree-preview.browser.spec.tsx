import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import commonEn from '@/i18n/locales/en-US/common.json'
import knowledgeSourcesEn from '@/i18n/locales/en-US/knowledge-sources.json'
import knowledgeSpaceEn from '@/i18n/locales/en-US/knowledge-space.json'
import requestErrorsEn from '@/i18n/locales/en-US/request-errors.json'
import commonZh from '@/i18n/locales/zh-Hans/common.json'
import knowledgeSourcesZh from '@/i18n/locales/zh-Hans/knowledge-sources.json'
import knowledgeSpaceZh from '@/i18n/locales/zh-Hans/knowledge-space.json'
import requestErrorsZh from '@/i18n/locales/zh-Hans/request-errors.json'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { InitialGitHubTreePreview } from '../initial-github-tree-preview'

vi.unmock('react-i18next')

setupFakeApi({
  console: {
    knowledgeFs: {
      sourceProviderPreview: {
        post: () => {
          throw apiError({ status: 500, message: 'Upstream failure' })
        },
      },
    },
  },
})

const binding = {
  credentialId: 'credential-github',
  datasource: 'github',
  pluginId: 'langgenius/github_datasource',
  provider: 'github',
  providerDisplayName: 'GitHub',
}

async function setup() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: {
      'en-US': {
        common: commonEn,
        knowledgeSources: knowledgeSourcesEn,
        knowledgeSpace: knowledgeSpaceEn,
        requestErrors: requestErrorsEn,
      },
      'zh-Hans': {
        common: commonZh,
        knowledgeSources: knowledgeSourcesZh,
        knowledgeSpace: knowledgeSpaceZh,
        requestErrors: requestErrorsZh,
      },
    },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  await render(
    <I18nextProvider i18n={i18n}>
      <InitialGitHubTreePreview
        binding={binding}
        disabled={false}
        parameters={{ repository: 'langgenius/dify' }}
        selectedResources={[]}
        onSelectionChange={() => {}}
      />
    </I18nextProvider>,
  )
  return { i18n }
}

describe('InitialGitHubTreePreview', () => {
  it('shows a failed preview in the language chosen after the failure', async () => {
    const { i18n } = await setup()

    await userEvent.click(page.getByRole('button', { name: knowledgeSpaceEn.preview }))
    await expect
      .element(page.getByRole('alert'))
      .toMatchTextContent(knowledgeSpaceEn.providerLoadFailed)

    await i18n.changeLanguage('zh-Hans')

    await expect
      .element(page.getByRole('alert'))
      .toMatchTextContent(knowledgeSpaceZh.providerLoadFailed)
    await expect
      .element(page.getByRole('button', { name: knowledgeSpaceZh.retryProviderLoad }))
      .toBeVisible()
  })
})
