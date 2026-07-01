import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'
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

Then('Agent v2 unsupported file format rejection should be available', async function (this: DifyWorld) {
  await expectFilesSectionVisible(this)

  return skipBlockedPrecondition(
    this,
    'Agent v2 unsupported file format rejection is not stable: default upload configuration allows arbitrary extensions unless UPLOAD_FILE_EXTENSION_BLACKLIST is seeded.',
    {
      owner: 'product/seed',
      remediation: 'Define Agent config file type restrictions or seed UPLOAD_FILE_EXTENSION_BLACKLIST before enabling this scenario.',
    },
  )
})

Then('Agent v2 oversized file rejection should be available', async function (this: DifyWorld) {
  await expectFilesSectionVisible(this)

  return skipBlockedPrecondition(
    this,
    'Agent v2 oversized file rejection lacks a clear user-visible reason: the current upload dialog collapses upload and commit failures into a generic failure toast.',
    {
      owner: 'product',
      remediation: 'Expose a stable user-visible file-size error before enabling this scenario.',
    },
  )
})

Then('Agent v2 single-batch file count limits should be available', async function (this: DifyWorld) {
  await expectFilesSectionVisible(this)

  return skipBlockedPrecondition(
    this,
    'Agent v2 single-batch file count limits are not reachable: the current Agent config file upload dialog accepts one file per upload.',
    {
      owner: 'product',
      remediation: 'Define multi-file upload behavior and its count-limit error before enabling this scenario.',
    },
  )
})

Then('Agent v2 total file count limits should be available', async function (this: DifyWorld) {
  await expectFilesSectionVisible(this)

  return skipBlockedPrecondition(
    this,
    'Agent v2 total file count limits are not defined for Agent config files in the current product contract.',
    {
      owner: 'product',
      remediation: 'Define the Agent config file total-count limit and user-visible error before enabling this scenario.',
    },
  )
})

Then('Agent v2 in-progress file upload recovery should be available', async function (this: DifyWorld) {
  await expectFilesSectionVisible(this)

  return skipBlockedPrecondition(
    this,
    'Agent v2 in-progress file upload recovery is not stable: the current dialog has no deterministic slow-upload fixture or user-visible navigation guard contract.',
    {
      owner: 'product/test-infra',
      remediation: 'Define upload-in-progress navigation behavior and provide a deterministic slow upload fixture before enabling this scenario.',
    },
  )
})

async function expectFilesSectionVisible(world: DifyWorld) {
  await expect(world.getPage().getByRole('region', { name: 'Files' }))
    .toBeVisible({ timeout: 30_000 })
}
