import type { Meta, StoryObj } from '@storybook/nextjs'
import React, { useEffect, useState } from 'react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import TriggerEventsLimitModal from '.'
import { Plan } from '../type'

const i18n = i18next.createInstance()
i18n.init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        billing: {
          triggerLimitModal: {
            title: 'Upgrade to unlock unlimited triggers per workflow',
            description: 'You’ve reached the limit of 2 triggers per workflow for this plan. Upgrade to publish this workflow.',
            dismiss: 'Dismiss',
            upgrade: 'Upgrade',
            usageTitle: 'TRIGGER EVENTS',
          },
          usagePage: {
            triggerEvents: 'Trigger Events',
            resetsIn: 'Resets in {{count, number}} days',
          },
          upgradeBtn: {
            encourage: 'Upgrade Now',
            encourageShort: 'Upgrade',
            plain: 'View Plan',
          },
        },
      },
    },
  },
})

const Template = (args: React.ComponentProps<typeof TriggerEventsLimitModal>) => {
  const [visible, setVisible] = useState<boolean>(args.show ?? true)
  useEffect(() => {
    setVisible(args.show ?? true)
  }, [args.show])
  const handleHide = () => setVisible(false)
  return (
    <I18nextProvider i18n={i18n}>
      <div className="flex flex-col gap-4">
        <button
          className="rounded-lg border border-divider-subtle px-4 py-2 text-sm text-text-secondary hover:border-divider-deep hover:text-text-primary"
          onClick={() => setVisible(true)}
        >
          Open Modal
        </button>
        <TriggerEventsLimitModal
          {...args}
          show={visible}
          onDismiss={handleHide}
          onUpgrade={handleHide}
        />
      </div>
    </I18nextProvider>
  )
}

const meta = {
  title: 'Billing/TriggerEventsLimitModal',
  component: TriggerEventsLimitModal,
  parameters: {
    layout: 'centered',
  },
  args: {
    show: true,
    usage: 120,
    total: 120,
    resetInDays: 5,
    planType: Plan.professional,
  },
} satisfies Meta<typeof TriggerEventsLimitModal>

export default meta
type Story = StoryObj<typeof meta>

export const Professional: Story = {
  args: {
    onDismiss: () => { /* noop */ },
    onUpgrade: () => { /* noop */ },
  },
  render: args => <Template {...args} />,
}

export const Sandbox: Story = {
  render: args => <Template {...args} />,
  args: {
    onDismiss: () => { /* noop */ },
    onUpgrade: () => { /* noop */ },
    resetInDays: undefined,
    planType: Plan.sandbox,
  },
}
