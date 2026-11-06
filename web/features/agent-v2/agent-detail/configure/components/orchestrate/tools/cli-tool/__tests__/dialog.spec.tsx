import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { CliToolDialog } from '../dialog'

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => () => 'https://docs.example.com',
}))

type CliToolDialogProps = Parameters<typeof CliToolDialog>[0]

function renderCliToolDialog(props?: Partial<CliToolDialogProps>) {
  const onOpenChange = vi.fn()
  const onSaveCliTool = vi.fn()

  render(
    <CliToolDialog open onOpenChange={onOpenChange} onSaveCliTool={onSaveCliTool} {...props} />,
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

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.add',
        }),
      )

      expect(onSaveCliTool).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      expect(toast.error).toHaveBeenCalledWith(
        'agentV2.agentDetail.configure.tools.cliDialog.installCommand.required',
      )
      expect(
        screen.queryByText('agentV2.agentDetail.configure.tools.cliDialog.installCommand.required'),
      ).not.toBeInTheDocument()
    })

    it('should show a toast error when CLI tool name is empty', async () => {
      const user = userEvent.setup()
      const { onOpenChange, onSaveCliTool } = renderCliToolDialog({ onDeleteCliTool: vi.fn() })

      expect(
        screen.queryByRole('button', { name: 'common.operation.remove' }),
      ).not.toBeInTheDocument()

      await user.type(
        screen.getByRole('textbox', {
          name: /agentV2\.agentDetail\.configure\.tools\.cliDialog\.installCommand\.label/,
        }),
        'npm install -g @lark/cli',
      )
      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.add',
        }),
      )

      expect(onSaveCliTool).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      expect(toast.error).toHaveBeenCalledWith(
        'agentV2.agentDetail.configure.tools.cliDialog.name.required',
      )
      expect(
        screen.queryByText('agentV2.agentDetail.configure.tools.cliDialog.name.required'),
      ).not.toBeInTheDocument()
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
      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.add',
        }),
      )

      expect(onSaveCliTool).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'cli',
          name: 'Lark CLI',
          installCommand: 'npm install -g @lark/cli',
        }),
      )
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe('Actions', () => {
    it('should save changes to an existing CLI tool without changing its identity', async () => {
      const user = userEvent.setup()
      const { onOpenChange, onSaveCliTool } = renderCliToolDialog({
        mode: 'edit',
        tool: {
          id: 'lark-cli',
          kind: 'cli',
          name: 'Lark CLI',
          installCommand: 'npm install -g @lark/cli',
        },
      })

      const nameInput = screen.getByRole('textbox', {
        name: /agentV2\.agentDetail\.configure\.tools\.cliDialog\.name\.label/,
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Lark CLI')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(onSaveCliTool).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: 'lark-cli',
          kind: 'cli',
          name: 'Updated Lark CLI',
          installCommand: 'npm install -g @lark/cli',
        }),
      )
      expect(onOpenChange).toHaveBeenCalledWith(false)
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

      await user.click(
        screen.getByRole('button', {
          name: 'common.operation.remove',
        }),
      )

      expect(onDeleteCliTool).toHaveBeenCalledWith('lark-cli')
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onSaveCliTool).not.toHaveBeenCalled()
    })
  })
})
