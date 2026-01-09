import type { Meta, StoryObj } from '@storybook/nextjs'
import { useState } from 'react'
import Confirm from '.'
import Button from '../button'

const meta = {
  title: 'Base/Feedback/Confirm',
  component: Confirm,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Confirmation dialog component that supports warning and info types, with customizable button text and behavior.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['info', 'warning'],
      description: 'Dialog type',
    },
    isShow: {
      control: 'boolean',
      description: 'Whether to show the dialog',
    },
    title: {
      control: 'text',
      description: 'Dialog title',
    },
    content: {
      control: 'text',
      description: 'Dialog content',
    },
    confirmText: {
      control: 'text',
      description: 'Confirm button text',
    },
    cancelText: {
      control: 'text',
      description: 'Cancel button text',
    },
    isLoading: {
      control: 'boolean',
      description: 'Confirm button loading state',
    },
    isDisabled: {
      control: 'boolean',
      description: 'Confirm button disabled state',
    },
    showConfirm: {
      control: 'boolean',
      description: 'Whether to show confirm button',
    },
    showCancel: {
      control: 'boolean',
      description: 'Whether to show cancel button',
    },
    maskClosable: {
      control: 'boolean',
      description: 'Whether clicking mask closes dialog',
    },
  },
  args: {
    onConfirm: () => {
      console.log('✅ User clicked confirm')
    },
    onCancel: () => {
      console.log('❌ User clicked cancel')
    },
  },
} satisfies Meta<typeof Confirm>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const ConfirmDemo = (args: any) => {
  const [isShow, setIsShow] = useState(false)

  return (
    <div>
      <Button variant="primary" onClick={() => setIsShow(true)}>
        Open Dialog
      </Button>
      <Confirm
        {...args}
        isShow={isShow}
        onConfirm={() => {
          console.log('✅ User clicked confirm')
          setIsShow(false)
        }}
        onCancel={() => {
          console.log('❌ User clicked cancel')
          setIsShow(false)
        }}
      />
    </div>
  )
}

// Basic warning dialog - Delete action
export const WarningDialog: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'warning',
    title: 'Delete Confirmation',
    content: 'Are you sure you want to delete this project? This action cannot be undone.',
    isShow: false,
  },
}

// Info dialog
export const InfoDialog: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'info',
    title: 'Notice',
    content: 'Your changes have been saved. Do you want to proceed to the next step?',
    isShow: false,
  },
}

// Custom button text
export const CustomButtonText: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'warning',
    title: 'Exit Editor',
    content: 'You have unsaved changes. Are you sure you want to exit?',
    confirmText: 'Discard Changes',
    cancelText: 'Continue Editing',
    isShow: false,
  },
}

// Loading state
export const LoadingState: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'warning',
    title: 'Deleting...',
    content: 'Please wait while we delete the file...',
    isLoading: true,
    isShow: false,
  },
}

// Disabled state
export const DisabledState: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'info',
    title: 'Verification Required',
    content: 'Please complete email verification before proceeding.',
    isDisabled: true,
    isShow: false,
  },
}

// Alert style - Confirm button only
export const AlertStyle: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'info',
    title: 'Success',
    content: 'Your settings have been updated!',
    showCancel: false,
    confirmText: 'Got it',
    isShow: false,
  },
}

// Dangerous action - Long content
export const DangerousAction: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'warning',
    title: 'Permanently Delete Account',
    content: 'This action will permanently delete your account and all associated data, including: all projects and files, collaboration history, and personal settings. This action cannot be reversed!',
    confirmText: 'Delete My Account',
    cancelText: 'Keep My Account',
    isShow: false,
  },
}

// Non-closable mask
export const NotMaskClosable: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'warning',
    title: 'Important Action',
    content: 'This action requires your explicit choice. Clicking outside will not close this dialog.',
    maskClosable: false,
    isShow: false,
  },
}

// Full feature demo - Playground
export const Playground: Story = {
  render: args => <ConfirmDemo {...args} />,
  args: {
    type: 'warning',
    title: 'This is a title',
    content: 'This is the dialog content text...',
    confirmText: undefined,
    cancelText: undefined,
    isLoading: false,
    isDisabled: false,
    showConfirm: true,
    showCancel: true,
    maskClosable: true,
    isShow: false,
  },
}
