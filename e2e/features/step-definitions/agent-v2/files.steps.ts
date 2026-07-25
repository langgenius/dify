import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { agentBuilderTestMaterials } from '../../agent-v2/support/test-materials'
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

When(
  'I upload the special-name Agent v2 file from the Files section',
  async function (this: DifyWorld) {
    await uploadAgentConfigFile(this, 'specialFilename')
  },
)

When(
  'I drop multiple Agent v2 files into the Files upload dialog',
  async function (this: DifyWorld) {
    const page = this.getPage()

    await page.getByRole('button', { name: 'Add file' }).click()
    const dialog = page.getByRole('dialog', { name: 'Upload file' })
    await expect(dialog).toBeVisible()

    const dropZone = dialog.getByRole('group', { name: 'Upload file' })
    await expect(dropZone).toBeVisible()

    const droppedFileNames: [string, string] = [
      agentBuilderTestMaterials.smallFile,
      agentBuilderTestMaterials.emptyFile,
    ]
    const dataTransfer = await page.evaluateHandle(
      ([smallFileName, emptyFileName]: [string, string]) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(['small agent file'], smallFileName, { type: 'text/plain' }))
        transfer.items.add(new File([''], emptyFileName, { type: 'text/plain' }))
        return transfer
      },
      droppedFileNames,
    )

    await dropZone.dispatchEvent('dragenter', { dataTransfer })
    await dropZone.dispatchEvent('dragover', { dataTransfer })
    await dropZone.dispatchEvent('drop', { dataTransfer })
    await dataTransfer.dispose()
  },
)

Then(
  'the Agent v2 Files upload dialog should reject the multiple-file drop',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const dialog = page.getByRole('dialog', { name: 'Upload file' })

    await expect(page.getByText('Upload one file.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Upload' })).toBeDisabled()
    await expect(
      dialog.getByText(agentBuilderTestMaterials.smallFile, { exact: true }),
    ).not.toBeVisible()
    await expect(
      dialog.getByText(agentBuilderTestMaterials.emptyFile, { exact: true }),
    ).not.toBeVisible()
  },
)

Then(
  'I should not see the dropped Agent v2 files in the Files section',
  async function (this: DifyWorld) {
    await expectAgentConfigFileHidden(this, 'smallFile')
    await expectAgentConfigFileHidden(this, 'emptyFile')
  },
)

Then('I should see the small Agent v2 file in the Files section', async function (this: DifyWorld) {
  await expectAgentConfigFileVisible(this, 'smallFile')
})

Then('I should see the empty Agent v2 file in the Files section', async function (this: DifyWorld) {
  await expectAgentConfigFileVisible(this, 'emptyFile')
})

Then(
  'I should not see the small Agent v2 file in the Files section',
  async function (this: DifyWorld) {
    await expectAgentConfigFileHidden(this, 'smallFile')
  },
)

Then(
  'I should see the special-name Agent v2 file in the Files section',
  async function (this: DifyWorld) {
    await expectAgentConfigFileVisible(this, 'specialFilename')
  },
)
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
