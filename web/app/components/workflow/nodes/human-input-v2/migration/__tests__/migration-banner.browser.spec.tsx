import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import HumanInputMigrationBanner from '../migration-banner'
import HumanInputMigrationDialog from '../migration-dialog'

function BannerOwner({ canEdit = true }: { canEdit?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <HumanInputMigrationBanner
        canEdit={canEdit}
        helpLink="https://docs.example/human-input"
        onMigrate={() => setOpen(true)}
      />
      <HumanInputMigrationDialog
        open={open}
        pending={false}
        nodeCount={1}
        onOpenChange={setOpen}
        onConfirm={() => setOpen(false)}
      />
    </>
  )
}

beforeEach(async () => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(1000, 700)
})

it('shows guidance and opens the migration confirmation for editors', async () => {
  await render(<BannerOwner />)
  await expect
    .element(page.getByText('workflow.nodes.humanInputMigration.banner.description'))
    .toBeVisible()
  await expect
    .element(
      page.getByRole('link', { name: /workflow.nodes.humanInputMigration.banner.learnMore/ }),
    )
    .toHaveAttribute('href', 'https://docs.example/human-input')
  await page
    .getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrateNow' })
    .click()
  await expect
    .element(
      page.getByRole('alertdialog', {
        name: 'workflow.nodes.humanInputMigration.dialog.title:{"count":1}',
      }),
    )
    .toBeVisible()
})

it('keeps the explanation and documentation without offering read-only migration', async () => {
  await render(<BannerOwner canEdit={false} />)
  await expect
    .element(page.getByText('workflow.nodes.humanInputMigration.banner.description'))
    .toBeVisible()
  await expect
    .element(page.getByRole('link'))
    .toHaveAttribute('href', 'https://docs.example/human-input')
  await expect
    .element(
      page.getByRole('button', { name: 'workflow.nodes.humanInputMigration.action.migrateNow' }),
    )
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
})

it('dismisses the migration banner without opening the migration dialog', async () => {
  await render(<BannerOwner />)
  await page.getByRole('button', { name: 'common.operation.close' }).click()
  await expect
    .element(page.getByText('workflow.nodes.humanInputMigration.banner.description'))
    .not.toBeInTheDocument()
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
})
