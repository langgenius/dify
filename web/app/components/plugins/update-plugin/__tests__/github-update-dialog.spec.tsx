import type { UpdatePluginPayload } from '../../types'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createDeferred } from '@/test/deferred'
import { GitHubInstallDialog } from '../../install-plugin/install-from-github/dialog'
import { PluginCategoryEnum } from '../../types'

vi.mock('../../install-plugin/install-from-github', () => ({
  default: ({ onSuccess }: { onSuccess: () => Promise<void> }) => (
    <button data-testid="save-plugin-update" onClick={onSuccess}>
      Save plugin update
    </button>
  ),
}))

function Update({
  category,
  onSave,
}: {
  category: PluginCategoryEnum
  onSave: () => Promise<void>
}) {
  const [handle] = useState(() => createDialogHandle<UpdatePluginPayload>())
  return (
    <>
      <button
        onClick={() =>
          handle.openWithPayload({
            category,
            github: {
              originalPackageInfo: {
                id: 'plugin@1.0.0',
                repo: 'owner/repo',
                version: '1.0.0',
                package: 'plugin.difypkg',
                releases: [],
              },
            },
          })
        }
      >
        Open update
      </button>
      <GitHubInstallDialog handle={handle} onUpdated={onSave} />
    </>
  )
}

describe('GitHub plugin updates', () => {
  it('keeps a model plugin update open until its refresh callback finishes', async () => {
    let resolveSave: (() => void) | undefined
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    const user = userEvent.setup()

    render(<Update onSave={onSave} category={PluginCategoryEnum.model} />)

    await user.click(screen.getByRole('button', { name: 'Open update' }))
    await user.click(await screen.findByTestId('save-plugin-update'))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('save-plugin-update')).toBeInTheDocument()

    resolveSave?.()

    await waitFor(() => {
      expect(screen.queryByTestId('save-plugin-update')).not.toBeInTheDocument()
    })
  })

  it('closes a non-model plugin update immediately after saving', async () => {
    const refresh = createDeferred()
    const onSave = vi.fn(() => refresh.promise)
    const user = userEvent.setup()

    render(<Update onSave={onSave} category={PluginCategoryEnum.tool} />)

    await user.click(screen.getByRole('button', { name: 'Open update' }))
    await user.click(await screen.findByTestId('save-plugin-update'))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('save-plugin-update')).not.toBeInTheDocument()
    refresh.resolve()
  })
})
