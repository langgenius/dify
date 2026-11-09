import type { DifyWorld } from '../../support/world.ts'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { agentBuilderTestMaterials } from '../../agent-v2/support/test-materials.ts'
import {
  expectAgentConfigFileHidden,
  expectAgentConfigFileSaved,
  expectAgentConfigFileVisible,
  submitAgentConfigFiles,
  uploadAgentConfigFile,
} from './configure-helpers.ts'

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
    const dialog = page.getByRole('dialog', { name: 'Upload files', exact: true })
    await expect(dialog).toBeVisible()

    const dropZone = dialog.getByRole('group', { name: 'Upload files', exact: true })
    await expect(dropZone).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'browse', exact: true })).toBeEnabled()

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
  'the Agent v2 Files upload dialog should queue every dropped file',
  async function (this: DifyWorld) {
    const dialog = this.getPage().getByRole('dialog', { name: 'Upload files', exact: true })

    for (const fileName of [
      agentBuilderTestMaterials.smallFile,
      agentBuilderTestMaterials.emptyFile,
    ]) {
      await expect(dialog.getByRole('listitem').getByText(fileName, { exact: true })).toBeVisible()
    }
    await expect(dialog.getByRole('button', { name: 'Upload', exact: true })).toBeEnabled()
  },
)

When('I upload the dropped Agent v2 files', async function (this: DifyWorld) {
  const dialog = this.getPage().getByRole('dialog', { name: 'Upload files', exact: true })
  await submitAgentConfigFiles(this, dialog, [
    agentBuilderTestMaterials.smallFile,
    agentBuilderTestMaterials.emptyFile,
  ])
})

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
