import { toast } from '@langgenius/dify-ui/toast'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CliToolDialog } from '../dialog'

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

type CliToolDialogProps = Parameters<typeof CliToolDialog>[0]

function renderCliToolDialog(props?: Partial<CliToolDialogProps>) {
  const onOpenChange = vi.fn()
  const onSaveCliTool = vi.fn()

  render(
    <CliToolDialog
      open
      onOpenChange={onOpenChange}
      onSaveCliTool={onSaveCliTool}
      {...props}
    />,
  )

  return {
    onOpenChange,
    onSaveCliTool,
  }
}

describe('CliToolDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Form Validation', () => {
    it('should show a toast error when install command is empty', async () => {
      const user = userEvent.setup()
      const { onOpenChange, onSaveCliTool } = renderCliToolDialog()

      await user.click(screen.getByRole('button', {
        name: 'common.operation.add',
      }))

      expect(onSaveCliTool).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      expect(toast.error).toHaveBeenCalledWith('agentV2.agentDetail.configure.tools.cliDialog.installCommand.required')
      expect(screen.queryByText('agentV2.agentDetail.configure.tools.cliDialog.installCommand.required')).not.toBeInTheDocument()
    })

    it('should show a toast error when CLI tool name is empty', async () => {
      const user = userEvent.setup()
      const { onOpenChange, onSaveCliTool } = renderCliToolDialog()

      await user.type(
        screen.getByRole('textbox', {
          name: /agentV2\.agentDetail\.configure\.tools\.cliDialog\.installCommand\.label/,
        }),
        'npm install -g @lark/cli',
      )
      await user.click(screen.getByRole('button', {
        name: 'common.operation.add',
      }))

      expect(onSaveCliTool).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      expect(toast.error).toHaveBeenCalledWith('agentV2.agentDetail.configure.tools.cliDialog.name.required')
      expect(screen.queryByText('agentV2.agentDetail.configure.tools.cliDialog.name.required')).not.toBeInTheDocument()
    })

    it('should save a CLI tool when required fields are filled', async () => {
      const user = userEvent.setup()
      const { onOpenChange, onSaveCliTool } = renderCliToolDialog()

      await user.type(
        screen.getByRole('textbox', {
          name: /agentV2\.agentDetail\.configure\.tools\.cliDialog\.installCommand\.label/,
        }),
        'npm install -g @lark/cli',
      )
      await user.type(
        screen.getByRole('textbox', {
          name: /agentV2\.agentDetail\.configure\.tools\.cliDialog\.name\.label/,
        }),
        'Lark CLI',
      )
      await user.click(screen.getByRole('button', {
        name: 'common.operation.add',
      }))

      expect(onSaveCliTool).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'cli',
        name: 'Lark CLI',
        installCommand: 'npm install -g @lark/cli',
      }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('should reject environment variable keys using the shared env editor rules', () => {
      renderCliToolDialog()

      const keyInput = screen.getByPlaceholderText('agentV2.agentDetail.configure.advancedSettings.envEditor.keyPlaceholder')

      fireEvent.change(keyInput, {
        target: { value: '1BAD' },
      })

      expect(keyInput).toHaveValue('')
      expect(toast.error).toHaveBeenCalledWith('appDebug.varKeyError.notStartWithNumber:{"key":"agentV2.agentDetail.configure.advancedSettings.envEditor.keyColumn"}')
    })
  })

  describe('Actions', () => {
    it('should keep the form open when the backdrop is clicked', async () => {
      const user = userEvent.setup()
      const { onOpenChange } = renderCliToolDialog()

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.tools.cliDialog.title',
      })
      const backdrop = document.body.querySelector('.bg-background-overlay') as HTMLElement
      await user.click(backdrop)

      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      expect(dialog).toBeInTheDocument()

      await user.click(screen.getByRole('button', {
        name: 'common.operation.cancel',
      }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('should show save action when editing a CLI tool', () => {
      renderCliToolDialog({
        mode: 'edit',
        tool: {
          id: 'lark-cli',
          kind: 'cli',
          name: 'Lark CLI',
          installCommand: 'npm install -g @lark/cli',
        },
      })

      expect(screen.getByRole('button', {
        name: 'common.operation.save',
      })).toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'common.operation.add',
      })).not.toBeInTheDocument()
    })

    it('should remove a CLI tool from the edit footer', async () => {
      const user = userEvent.setup()
      const onDeleteCliTool = vi.fn()
      const { onOpenChange, onSaveCliTool } = renderCliToolDialog({
        mode: 'edit',
        onDeleteCliTool,
        tool: {
          id: 'lark-cli',
          kind: 'cli',
          name: 'Lark CLI',
          installCommand: 'npm install -g @lark/cli',
        },
      })

      await user.click(screen.getByRole('button', {
        name: 'common.operation.remove',
      }))

      expect(onDeleteCliTool).toHaveBeenCalledWith('lark-cli')
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onSaveCliTool).not.toHaveBeenCalled()
    })

    it('should hide remove action when adding a CLI tool', () => {
      renderCliToolDialog({
        onDeleteCliTool: vi.fn(),
      })

      expect(screen.queryByRole('button', {
        name: 'common.operation.remove',
      })).not.toBeInTheDocument()
    })
  })
})
