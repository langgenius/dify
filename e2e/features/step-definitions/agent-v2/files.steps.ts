import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { agentBuilderFileTreeFixtureFileNames } from '../../agent-v2/support/test-materials'
import {
  expectAgentConfigFileHidden,
  expectAgentConfigFileSaved,
  expectAgentConfigFileVisible,
  uploadAgentConfigFile,
} from './configure-helpers'

When('I upload the small Agent v2 file from the Files section', async function (this: DifyWorld) {
  await uploadAgentConfigFile(this, 'smallFile')
})

When('I upload the empty Agent v2 file from the Files section', async function (this: DifyWorld) {
  await uploadAgentConfigFile(this, 'emptyFile')
})

When('I upload the special-name Agent v2 file from the Files section', async function (this: DifyWorld) {
  await uploadAgentConfigFile(this, 'specialFilename')
})

Then(
  'I should see the Agent v2 file fixture entries in the current flat Files list',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const filesSection = page.getByRole('region', { name: 'Files' })
    const filesList = filesSection.getByLabel('Agent files')

    await expect(filesSection).toBeVisible({ timeout: 30_000 })
    await expect(filesList).toBeVisible()

    for (const fileName of agentBuilderFileTreeFixtureFileNames) {
      await expect(filesList.getByRole('button', {
        exact: true,
        name: fileName,
      })).toBeVisible()
    }

    await expect(filesList.getByRole('button', { exact: true, name: 'assets' })).toHaveCount(0)
    await expect(filesList.getByRole('button', { exact: true, name: 'docs' })).toHaveCount(0)
    await expect(filesList.getByRole('button', { exact: true, name: 'public' })).toHaveCount(0)
    await expect(filesList.getByRole('button', { exact: true, name: 'src' })).toHaveCount(0)
    await expect(filesList.getByRole('button', { exact: true, name: 'web-game' })).toHaveCount(0)
  },
)
Then('I should see the small Agent v2 file in the Files section', async function (this: DifyWorld) {
  await expectAgentConfigFileVisible(this, 'smallFile')
})

Then('I should see the empty Agent v2 file in the Files section', async function (this: DifyWorld) {
  await expectAgentConfigFileVisible(this, 'emptyFile')
})

Then('I should not see the small Agent v2 file in the Files section', async function (this: DifyWorld) {
  await expectAgentConfigFileHidden(this, 'smallFile')
})

Then('I should see the special-name Agent v2 file in the Files section', async function (this: DifyWorld) {
  await expectAgentConfigFileVisible(this, 'specialFilename')
})
Then(
  'the small Agent v2 file should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectAgentConfigFileSaved(this, 'smallFile')
  },
)

Then(
  'the empty Agent v2 file should be saved as a zero-byte file in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectAgentConfigFileSaved(this, 'emptyFile', { size: 0 })
  },
)

Then(
  'the special-name Agent v2 file should be saved in the Agent v2 draft',
  async function (this: DifyWorld) {
    await expectAgentConfigFileSaved(this, 'specialFilename')
  },
)
