import type { Meta, StoryObj } from '@storybook/nextjs'
import { useEffect, useState } from 'react'
import Modal from './modal'

const meta = {
  title: 'Base/Feedback/RichModal',
  component: Modal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Full-featured modal with header, subtitle, customizable footer buttons, and optional extra action.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'radio',
      options: ['sm', 'md'],
      description: 'Defines the panel width.',
    },
    title: {
      control: 'text',
      description: 'Primary heading text.',
    },
    subTitle: {
      control: 'text',
      description: 'Secondary text below the title.',
    },
    confirmButtonText: {
      control: 'text',
      description: 'Label for the confirm button.',
    },
    cancelButtonText: {
      control: 'text',
      description: 'Label for the cancel button.',
    },
    showExtraButton: {
      control: 'boolean',
      description: 'Whether to render the extra button.',
    },
    extraButtonText: {
      control: 'text',
      description: 'Label for the extra button.',
    },
    extraButtonVariant: {
      control: 'select',
      options: ['primary', 'warning', 'secondary', 'secondary-accent', 'ghost', 'ghost-accent', 'tertiary'],
      description: 'Visual style for the extra button.',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables footer actions when true.',
    },
    footerSlot: {
      control: false,
    },
    bottomSlot: {
      control: false,
    },
    onClose: {
      control: false,
      description: 'Handler fired when the close icon or backdrop is clicked.',
    },
    onConfirm: {
      control: false,
      description: 'Handler fired when confirm is pressed.',
    },
    onCancel: {
      control: false,
      description: 'Handler fired when cancel is pressed.',
    },
    onExtraButtonClick: {
      control: false,
      description: 'Handler fired when the extra button is pressed.',
    },
    children: {
      control: false,
    },
  },
  args: {
    size: 'sm',
    title: 'Delete integration',
    subTitle: 'Disabling this integration will revoke access tokens and webhooks.',
    confirmButtonText: 'Delete integration',
    cancelButtonText: 'Cancel',
    showExtraButton: false,
    extraButtonText: 'Disable temporarily',
    extraButtonVariant: 'warning',
    disabled: false,
    onClose: () => console.log('Modal closed'),
    onConfirm: () => console.log('Confirm pressed'),
    onCancel: () => console.log('Cancel pressed'),
    onExtraButtonClick: () => console.log('Extra button pressed'),
  },
} satisfies Meta<typeof Modal>

export default meta
type Story = StoryObj<typeof meta>

type ModalProps = React.ComponentProps<typeof Modal>

const ModalDemo = (props: ModalProps) => {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (props.disabled && open)
      setOpen(false)
  }, [props.disabled, open])

  const {
    onClose,
    onConfirm,
    onCancel,
    onExtraButtonClick,
    children,
    ...rest
  } = props

  const handleClose = () => {
    onClose?.()
    setOpen(false)
  }

  const handleConfirm = () => {
    onConfirm?.()
    setOpen(false)
  }

  const handleCancel = () => {
    onCancel?.()
    setOpen(false)
  }

  const handleExtra = () => {
    onExtraButtonClick?.()
  }

  return (
    <div className="relative flex h-[480px] items-center justify-center bg-gray-100">
      <button
        className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        onClick={() => setOpen(true)}
      >
        Show rich modal
      </button>

      {open && (
        <Modal
          {...rest}
          onClose={handleClose}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onExtraButtonClick={handleExtra}
          children={children ?? (
            <div className="space-y-4 text-sm text-gray-600">
              <p>
                Removing integrations immediately stops workflow automations related to this connection.
                Make sure no scheduled jobs depend on this integration before proceeding.
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-gray-500">
                <li>All API credentials issued by this integration will be revoked.</li>
                <li>Historical logs remain accessible for auditing.</li>
                <li>You can re-enable the integration later with fresh credentials.</li>
              </ul>
            </div>
          )}
        />
      )}
    </div>
  )
}

export const Default: Story = {
  render: args => <ModalDemo {...args} />,
}

export const WithExtraAction: Story = {
  render: args => <ModalDemo {...args} />,
  args: {
    showExtraButton: true,
    extraButtonVariant: 'secondary',
    extraButtonText: 'Disable only',
    footerSlot: (
      <span className="text-xs text-gray-400">Last synced 5 minutes ago</span>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Illustrates the optional extra button and footer slot for advanced workflows.',
      },
    },
  },
}

export const MediumSized: Story = {
  render: args => <ModalDemo {...args} />,
  args: {
    size: 'md',
    subTitle: 'Use the larger width to surface forms with more fields or supporting descriptions.',
    bottomSlot: (
      <div className="border-t border-divider-subtle bg-components-panel-bg px-6 py-4 text-xs text-gray-500">
        Need finer control? Configure automation rules in the integration settings page.
      </div>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows the medium sized panel and a populated `bottomSlot` for supplemental messaging.',
      },
    },
  },
}
