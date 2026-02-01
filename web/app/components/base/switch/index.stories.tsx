import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import Switch from '.'

const meta = {
  title: 'Base/Data Entry/Switch',
  component: Switch,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Toggle switch component with multiple sizes (xs, sm, md, lg, l). Built on Headless UI Switch with smooth animations.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'l'],
      description: 'Switch size',
    },
    defaultValue: {
      control: 'boolean',
      description: 'Default checked state',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
  },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

// Interactive demo wrapper
const SwitchDemo = (args: any) => {
  const [enabled, setEnabled] = useState(args.defaultValue || false)

  return (
    <div style={{ width: '300px' }}>
      <div className="flex items-center gap-3">
        <Switch
          {...args}
          defaultValue={enabled}
          onChange={(value) => {
            setEnabled(value)
            console.log('Switch toggled:', value)
          }}
        />
        <span className="text-sm text-gray-700">
          {enabled ? 'On' : 'Off'}
        </span>
      </div>
    </div>
  )
}

// Default state (off)
export const Default: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    defaultValue: false,
    disabled: false,
  },
}

// Default on
export const DefaultOn: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    defaultValue: true,
    disabled: false,
  },
}

// Disabled off
export const DisabledOff: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    defaultValue: false,
    disabled: true,
  },
}

// Disabled on
export const DisabledOn: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    defaultValue: true,
    disabled: true,
  },
}

// Size variations
const SizeComparisonDemo = () => {
  const [states, setStates] = useState({
    xs: false,
    sm: false,
    md: true,
    lg: true,
    l: false,
  })

  return (
    <div style={{ width: '400px' }} className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch size="xs" defaultValue={states.xs} onChange={v => setStates({ ...states, xs: v })} />
          <span className="text-sm text-gray-700">Extra Small (xs)</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch size="sm" defaultValue={states.sm} onChange={v => setStates({ ...states, sm: v })} />
          <span className="text-sm text-gray-700">Small (sm)</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch size="md" defaultValue={states.md} onChange={v => setStates({ ...states, md: v })} />
          <span className="text-sm text-gray-700">Medium (md)</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch size="l" defaultValue={states.l} onChange={v => setStates({ ...states, l: v })} />
          <span className="text-sm text-gray-700">Large (l)</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch size="lg" defaultValue={states.lg} onChange={v => setStates({ ...states, lg: v })} />
          <span className="text-sm text-gray-700">Extra Large (lg)</span>
        </div>
      </div>
    </div>
  )
}

export const SizeComparison: Story = {
  render: () => <SizeComparisonDemo />,
}

// With labels
const WithLabelsDemo = () => {
  const [enabled, setEnabled] = useState(true)

  return (
    <div style={{ width: '400px' }}>
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <div className="text-sm font-medium text-gray-900">Email Notifications</div>
          <div className="text-xs text-gray-500">Receive email updates about your account</div>
        </div>
        <Switch
          size="md"
          defaultValue={enabled}
          onChange={setEnabled}
        />
      </div>
    </div>
  )
}

export const WithLabels: Story = {
  render: () => <WithLabelsDemo />,
}

// Real-world example - Settings panel
const SettingsPanelDemo = () => {
  const [settings, setSettings] = useState({
    notifications: true,
    autoSave: true,
    darkMode: false,
    analytics: false,
    emailUpdates: true,
  })

  const updateSetting = (key: string, value: boolean) => {
    setSettings({ ...settings, [key]: value })
  }

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Application Settings</h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">Push Notifications</div>
            <div className="text-xs text-gray-500">Receive push notifications on your device</div>
          </div>
          <Switch
            size="md"
            defaultValue={settings.notifications}
            onChange={v => updateSetting('notifications', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">Auto-Save</div>
            <div className="text-xs text-gray-500">Automatically save changes as you work</div>
          </div>
          <Switch
            size="md"
            defaultValue={settings.autoSave}
            onChange={v => updateSetting('autoSave', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">Dark Mode</div>
            <div className="text-xs text-gray-500">Use dark theme for the interface</div>
          </div>
          <Switch
            size="md"
            defaultValue={settings.darkMode}
            onChange={v => updateSetting('darkMode', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">Analytics</div>
            <div className="text-xs text-gray-500">Help us improve by sharing usage data</div>
          </div>
          <Switch
            size="md"
            defaultValue={settings.analytics}
            onChange={v => updateSetting('analytics', v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">Email Updates</div>
            <div className="text-xs text-gray-500">Receive product updates via email</div>
          </div>
          <Switch
            size="md"
            defaultValue={settings.emailUpdates}
            onChange={v => updateSetting('emailUpdates', v)}
          />
        </div>
      </div>
    </div>
  )
}

export const SettingsPanel: Story = {
  render: () => <SettingsPanelDemo />,
}

// Real-world example - Privacy controls
const PrivacyControlsDemo = () => {
  const [privacy, setPrivacy] = useState({
    profilePublic: false,
    showEmail: false,
    allowMessages: true,
    shareActivity: false,
  })

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-2 text-lg font-semibold">Privacy Settings</h3>
      <p className="mb-4 text-sm text-gray-600">Control who can see your information</p>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">Public Profile</div>
            <div className="text-xs text-gray-500">Make your profile visible to everyone</div>
          </div>
          <Switch
            size="md"
            defaultValue={privacy.profilePublic}
            onChange={v => setPrivacy({ ...privacy, profilePublic: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">Show Email Address</div>
            <div className="text-xs text-gray-500">Display your email on your profile</div>
          </div>
          <Switch
            size="md"
            defaultValue={privacy.showEmail}
            onChange={v => setPrivacy({ ...privacy, showEmail: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">Allow Direct Messages</div>
            <div className="text-xs text-gray-500">Let others send you private messages</div>
          </div>
          <Switch
            size="md"
            defaultValue={privacy.allowMessages}
            onChange={v => setPrivacy({ ...privacy, allowMessages: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">Share Activity</div>
            <div className="text-xs text-gray-500">Show your recent activity to connections</div>
          </div>
          <Switch
            size="md"
            defaultValue={privacy.shareActivity}
            onChange={v => setPrivacy({ ...privacy, shareActivity: v })}
          />
        </div>
      </div>
    </div>
  )
}

export const PrivacyControls: Story = {
  render: () => <PrivacyControlsDemo />,
}

// Real-world example - Feature toggles
const FeatureTogglesDemo = () => {
  const [features, setFeatures] = useState({
    betaFeatures: false,
    experimentalUI: false,
    advancedMode: true,
    developerTools: false,
  })

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Feature Flags</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-xl">🧪</span>
            <div>
              <div className="text-sm font-medium text-gray-900">Beta Features</div>
              <div className="text-xs text-gray-500">Access experimental functionality</div>
            </div>
          </div>
          <Switch
            size="md"
            defaultValue={features.betaFeatures}
            onChange={v => setFeatures({ ...features, betaFeatures: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-xl">🎨</span>
            <div>
              <div className="text-sm font-medium text-gray-900">Experimental UI</div>
              <div className="text-xs text-gray-500">Try the new interface design</div>
            </div>
          </div>
          <Switch
            size="md"
            defaultValue={features.experimentalUI}
            onChange={v => setFeatures({ ...features, experimentalUI: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚡</span>
            <div>
              <div className="text-sm font-medium text-gray-900">Advanced Mode</div>
              <div className="text-xs text-gray-500">Show advanced configuration options</div>
            </div>
          </div>
          <Switch
            size="md"
            defaultValue={features.advancedMode}
            onChange={v => setFeatures({ ...features, advancedMode: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔧</span>
            <div>
              <div className="text-sm font-medium text-gray-900">Developer Tools</div>
              <div className="text-xs text-gray-500">Enable debugging and inspection tools</div>
            </div>
          </div>
          <Switch
            size="md"
            defaultValue={features.developerTools}
            onChange={v => setFeatures({ ...features, developerTools: v })}
          />
        </div>
      </div>
    </div>
  )
}

export const FeatureToggles: Story = {
  render: () => <FeatureTogglesDemo />,
}

// Real-world example - Notification preferences
const NotificationPreferencesDemo = () => {
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    sms: false,
    desktop: true,
  })

  const allEnabled = Object.values(notifications).every(v => v)
  const someEnabled = Object.values(notifications).some(v => v)

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Notification Channels</h3>
        <div className="text-xs text-gray-500">
          {allEnabled ? 'All enabled' : someEnabled ? 'Some enabled' : 'All disabled'}
        </div>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📧</span>
            <div>
              <div className="text-sm font-medium text-gray-900">Email</div>
              <div className="text-xs text-gray-500">Receive notifications via email</div>
            </div>
          </div>
          <Switch
            size="md"
            defaultValue={notifications.email}
            onChange={v => setNotifications({ ...notifications, email: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔔</span>
            <div>
              <div className="text-sm font-medium text-gray-900">Push Notifications</div>
              <div className="text-xs text-gray-500">Mobile and browser push notifications</div>
            </div>
          </div>
          <Switch
            size="md"
            defaultValue={notifications.push}
            onChange={v => setNotifications({ ...notifications, push: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💬</span>
            <div>
              <div className="text-sm font-medium text-gray-900">SMS Messages</div>
              <div className="text-xs text-gray-500">Receive text message notifications</div>
            </div>
          </div>
          <Switch
            size="md"
            defaultValue={notifications.sms}
            onChange={v => setNotifications({ ...notifications, sms: v })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💻</span>
            <div>
              <div className="text-sm font-medium text-gray-900">Desktop Alerts</div>
              <div className="text-xs text-gray-500">Show desktop notification popups</div>
            </div>
          </div>
          <Switch
            size="md"
            defaultValue={notifications.desktop}
            onChange={v => setNotifications({ ...notifications, desktop: v })}
          />
        </div>
      </div>
    </div>
  )
}

export const NotificationPreferences: Story = {
  render: () => <NotificationPreferencesDemo />,
}

// Real-world example - API access control
const APIAccessControlDemo = () => {
  const [access, setAccess] = useState({
    readAccess: true,
    writeAccess: true,
    deleteAccess: false,
    adminAccess: false,
  })

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-2 text-lg font-semibold">API Permissions</h3>
      <p className="mb-4 text-sm text-gray-600">Configure access levels for API key</p>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg bg-green-50 p-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span className="text-green-600">✓</span>
              {' '}
              Read Access
            </div>
            <div className="text-xs text-gray-500">View resources and data</div>
          </div>
          <Switch
            size="md"
            defaultValue={access.readAccess}
            onChange={v => setAccess({ ...access, readAccess: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-blue-50 p-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span className="text-blue-600">✎</span>
              {' '}
              Write Access
            </div>
            <div className="text-xs text-gray-500">Create and update resources</div>
          </div>
          <Switch
            size="md"
            defaultValue={access.writeAccess}
            onChange={v => setAccess({ ...access, writeAccess: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-red-50 p-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span className="text-red-600">🗑</span>
              {' '}
              Delete Access
            </div>
            <div className="text-xs text-gray-500">Remove resources permanently</div>
          </div>
          <Switch
            size="md"
            defaultValue={access.deleteAccess}
            onChange={v => setAccess({ ...access, deleteAccess: v })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-purple-50 p-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <span className="text-purple-600">⚡</span>
              {' '}
              Admin Access
            </div>
            <div className="text-xs text-gray-500">Full administrative privileges</div>
          </div>
          <Switch
            size="md"
            defaultValue={access.adminAccess}
            onChange={v => setAccess({ ...access, adminAccess: v })}
          />
        </div>
      </div>
    </div>
  )
}

export const APIAccessControl: Story = {
  render: () => <APIAccessControlDemo />,
}

// Compact list with switches
const CompactListDemo = () => {
  const [items, setItems] = useState([
    { id: 1, name: 'Feature A', enabled: true },
    { id: 2, name: 'Feature B', enabled: false },
    { id: 3, name: 'Feature C', enabled: true },
    { id: 4, name: 'Feature D', enabled: false },
    { id: 5, name: 'Feature E', enabled: true },
  ])

  const toggleItem = (id: number) => {
    setItems(items.map(item =>
      item.id === id ? { ...item, enabled: !item.enabled } : item,
    ))
  }

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold">Quick Toggles</h3>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-700">{item.name}</span>
            <Switch
              size="sm"
              defaultValue={item.enabled}
              onChange={() => toggleItem(item.id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export const CompactList: Story = {
  render: () => <CompactListDemo />,
}

// Interactive playground
export const Playground: Story = {
  render: args => <SwitchDemo {...args} />,
  args: {
    size: 'md',
    defaultValue: false,
    disabled: false,
  },
}
