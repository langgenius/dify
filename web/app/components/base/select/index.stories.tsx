import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { Item } from '.'
import { useState } from 'react'
import Select, { PortalSelect, SimpleSelect } from '.'

const meta = {
  title: 'Base/Data Entry/Select',
  component: SimpleSelect,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Select component with three variants: Select (with search), SimpleSelect (basic dropdown), and PortalSelect (portal-based positioning). Built on Headless UI.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    placeholder: {
      control: 'text',
      description: 'Placeholder text',
    },
    disabled: {
      control: 'boolean',
      description: 'Disabled state',
    },
    notClearable: {
      control: 'boolean',
      description: 'Hide clear button',
    },
    hideChecked: {
      control: 'boolean',
      description: 'Hide check icon on selected item',
    },
  },
  args: {
    onSelect: (item) => {
      console.log('Selected:', item)
    },
  },
} satisfies Meta<typeof SimpleSelect>

export default meta
type Story = StoryObj<typeof meta>

const fruits: Item[] = [
  { value: 'apple', name: 'Apple' },
  { value: 'banana', name: 'Banana' },
  { value: 'cherry', name: 'Cherry' },
  { value: 'date', name: 'Date' },
  { value: 'elderberry', name: 'Elderberry' },
]

const countries: Item[] = [
  { value: 'us', name: 'United States' },
  { value: 'uk', name: 'United Kingdom' },
  { value: 'ca', name: 'Canada' },
  { value: 'au', name: 'Australia' },
  { value: 'de', name: 'Germany' },
  { value: 'fr', name: 'France' },
  { value: 'jp', name: 'Japan' },
  { value: 'cn', name: 'China' },
]

// SimpleSelect Demo
const SimpleSelectDemo = (args: any) => {
  const [selected, setSelected] = useState(args.defaultValue || '')

  return (
    <div style={{ width: '300px' }}>
      <SimpleSelect
        {...args}
        items={fruits}
        defaultValue={selected}
        onSelect={(item) => {
          setSelected(item.value)
          console.log('Selected:', item)
        }}
      />
      {selected && (
        <div className="mt-3 text-sm text-gray-600">
          Selected:
          {' '}
          <span className="font-semibold">{selected}</span>
        </div>
      )}
    </div>
  )
}

// Default SimpleSelect
export const Default: Story = {
  render: args => <SimpleSelectDemo {...args} />,
  args: {
    placeholder: 'Select a fruit...',
    defaultValue: 'apple',
    items: [],
  },
}

// With placeholder (no selection)
export const WithPlaceholder: Story = {
  render: args => <SimpleSelectDemo {...args} />,
  args: {
    placeholder: 'Choose an option...',
    defaultValue: '',
    items: [],
  },
}

// Disabled state
export const Disabled: Story = {
  render: args => <SimpleSelectDemo {...args} />,
  args: {
    placeholder: 'Select a fruit...',
    defaultValue: 'banana',
    disabled: true,
    items: [],
  },
}

// Not clearable
export const NotClearable: Story = {
  render: args => <SimpleSelectDemo {...args} />,
  args: {
    placeholder: 'Select a fruit...',
    defaultValue: 'cherry',
    notClearable: true,
    items: [],
  },
}

// Hide checked icon
export const HideChecked: Story = {
  render: args => <SimpleSelectDemo {...args} />,
  args: {
    placeholder: 'Select a fruit...',
    defaultValue: 'apple',
    hideChecked: true,
    items: [],
  },
}

// Select with search
const WithSearchDemo = () => {
  const [selected, setSelected] = useState('us')

  return (
    <div style={{ width: '300px' }}>
      <Select
        items={countries}
        defaultValue={selected}
        onSelect={(item) => {
          setSelected(item.value as string)
          console.log('Selected:', item)
        }}
        allowSearch={true}
      />
      <div className="mt-3 text-sm text-gray-600">
        Selected:
        {' '}
        <span className="font-semibold">{selected}</span>
      </div>
    </div>
  )
}

export const WithSearch: Story = {
  render: () => <WithSearchDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// PortalSelect
const PortalSelectVariantDemo = () => {
  const [selected, setSelected] = useState('apple')

  return (
    <div style={{ width: '300px' }}>
      <PortalSelect
        value={selected}
        items={fruits}
        onSelect={(item) => {
          setSelected(item.value as string)
          console.log('Selected:', item)
        }}
        placeholder="Select a fruit..."
      />
      <div className="mt-3 text-sm text-gray-600">
        Selected:
        {' '}
        <span className="font-semibold">{selected}</span>
      </div>
    </div>
  )
}

export const PortalSelectVariant: Story = {
  render: () => <PortalSelectVariantDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Custom render option
const CustomRenderOptionDemo = () => {
  const [selected, setSelected] = useState('us')

  const countriesWithFlags = [
    { value: 'us', name: 'United States', flag: '🇺🇸' },
    { value: 'uk', name: 'United Kingdom', flag: '🇬🇧' },
    { value: 'ca', name: 'Canada', flag: '🇨🇦' },
    { value: 'au', name: 'Australia', flag: '🇦🇺' },
    { value: 'de', name: 'Germany', flag: '🇩🇪' },
  ]

  return (
    <div style={{ width: '300px' }}>
      <SimpleSelect
        items={countriesWithFlags}
        defaultValue={selected}
        onSelect={item => setSelected(item.value as string)}
        renderOption={({ item, selected }) => (
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">{item.flag}</span>
              <span>{item.name}</span>
            </div>
            {selected && <span className="text-blue-600">✓</span>}
          </div>
        )}
      />
    </div>
  )
}

export const CustomRenderOption: Story = {
  render: () => <CustomRenderOptionDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Loading state
export const LoadingState: Story = {
  render: () => {
    return (
      <div style={{ width: '300px' }}>
        <SimpleSelect
          items={[]}
          defaultValue=""
          onSelect={() => undefined}
          placeholder="Loading options..."
          isLoading={true}
        />
      </div>
    )
  },
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Form field
const FormFieldDemo = () => {
  const [formData, setFormData] = useState({
    country: 'us',
    language: 'en',
    timezone: 'pst',
  })

  const languages = [
    { value: 'en', name: 'English' },
    { value: 'es', name: 'Spanish' },
    { value: 'fr', name: 'French' },
    { value: 'de', name: 'German' },
    { value: 'zh', name: 'Chinese' },
  ]

  const timezones = [
    { value: 'pst', name: 'Pacific Time (PST)' },
    { value: 'mst', name: 'Mountain Time (MST)' },
    { value: 'cst', name: 'Central Time (CST)' },
    { value: 'est', name: 'Eastern Time (EST)' },
  ]

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">User Preferences</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Country</label>
          <SimpleSelect
            items={countries}
            defaultValue={formData.country}
            onSelect={item => setFormData({ ...formData, country: item.value as string })}
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Language</label>
          <SimpleSelect
            items={languages}
            defaultValue={formData.language}
            onSelect={item => setFormData({ ...formData, language: item.value as string })}
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Timezone</label>
          <SimpleSelect
            items={timezones}
            defaultValue={formData.timezone}
            onSelect={item => setFormData({ ...formData, timezone: item.value as string })}
          />
        </div>
      </div>
      <div className="mt-6 rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
        <div>
          <strong>Country:</strong>
          {' '}
          {formData.country}
        </div>
        <div>
          <strong>Language:</strong>
          {' '}
          {formData.language}
        </div>
        <div>
          <strong>Timezone:</strong>
          {' '}
          {formData.timezone}
        </div>
      </div>
    </div>
  )
}

export const FormField: Story = {
  render: () => <FormFieldDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Filter selector
const FilterSelectorDemo = () => {
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')

  const statusOptions = [
    { value: 'all', name: 'All Status' },
    { value: 'active', name: 'Active' },
    { value: 'pending', name: 'Pending' },
    { value: 'completed', name: 'Completed' },
    { value: 'cancelled', name: 'Cancelled' },
  ]

  const priorityOptions = [
    { value: 'all', name: 'All Priorities' },
    { value: 'high', name: 'High Priority' },
    { value: 'medium', name: 'Medium Priority' },
    { value: 'low', name: 'Low Priority' },
  ]

  return (
    <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Task Filters</h3>
      <div className="mb-6 flex gap-4">
        <div className="flex-1">
          <label className="mb-2 block text-xs font-medium text-gray-600">Status</label>
          <SimpleSelect
            items={statusOptions}
            defaultValue={status}
            onSelect={item => setStatus(item.value as string)}
            notClearable
          />
        </div>
        <div className="flex-1">
          <label className="mb-2 block text-xs font-medium text-gray-600">Priority</label>
          <SimpleSelect
            items={priorityOptions}
            defaultValue={priority}
            onSelect={item => setPriority(item.value as string)}
            notClearable
          />
        </div>
      </div>
      <div className="rounded-lg bg-blue-50 p-4 text-sm">
        <div className="mb-2 font-medium text-gray-700">Active Filters:</div>
        <div className="flex gap-2">
          <span className="rounded bg-blue-200 px-2 py-1 text-xs text-blue-800">
            Status:
            {' '}
            {status}
          </span>
          <span className="rounded bg-blue-200 px-2 py-1 text-xs text-blue-800">
            Priority:
            {' '}
            {priority}
          </span>
        </div>
      </div>
    </div>
  )
}

export const FilterSelector: Story = {
  render: () => <FilterSelectorDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Version selector with badge
const VersionSelectorDemo = () => {
  const [selectedVersion, setSelectedVersion] = useState('2.1.0')

  const versions = [
    { value: '3.0.0', name: 'v3.0.0 (Beta)' },
    { value: '2.1.0', name: 'v2.1.0 (Latest)' },
    { value: '2.0.5', name: 'v2.0.5' },
    { value: '2.0.4', name: 'v2.0.4' },
    { value: '1.9.8', name: 'v1.9.8' },
  ]

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Select Version</h3>
      <PortalSelect
        value={selectedVersion}
        items={versions}
        onSelect={item => setSelectedVersion(item.value as string)}
        installedValue="2.0.5"
        placeholder="Choose version..."
      />
      <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
        {selectedVersion !== '2.0.5' && (
          <div className="mb-2 text-yellow-600">
            ⚠️ Version change detected
          </div>
        )}
        <div>
          Current:
          <strong>{selectedVersion}</strong>
        </div>
        <div className="mt-1 text-xs text-gray-500">Installed: 2.0.5</div>
      </div>
    </div>
  )
}

export const VersionSelector: Story = {
  render: () => <VersionSelectorDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Settings dropdown
const SettingsDropdownDemo = () => {
  const [theme, setTheme] = useState('light')
  const [fontSize, setFontSize] = useState('medium')

  const themeOptions = [
    { value: 'light', name: '☀️ Light Mode' },
    { value: 'dark', name: '🌙 Dark Mode' },
    { value: 'auto', name: '🔄 Auto (System)' },
  ]

  const fontSizeOptions = [
    { value: 'small', name: 'Small (12px)' },
    { value: 'medium', name: 'Medium (14px)' },
    { value: 'large', name: 'Large (16px)' },
    { value: 'xlarge', name: 'Extra Large (18px)' },
  ]

  return (
    <div style={{ width: '400px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Display Settings</h3>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Theme</label>
          <SimpleSelect
            items={themeOptions}
            defaultValue={theme}
            onSelect={item => setTheme(item.value as string)}
            notClearable
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Font Size</label>
          <SimpleSelect
            items={fontSizeOptions}
            defaultValue={fontSize}
            onSelect={item => setFontSize(item.value as string)}
            notClearable
          />
        </div>
      </div>
    </div>
  )
}

export const SettingsDropdown: Story = {
  render: () => <SettingsDropdownDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Comparison of variants
const VariantComparisonDemo = () => {
  const [simple, setSimple] = useState('apple')
  const [withSearch, setWithSearch] = useState('us')
  const [portal, setPortal] = useState('banana')

  return (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-6 text-lg font-semibold">Select Variants Comparison</h3>
      <div className="space-y-6">
        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-700">SimpleSelect (Basic)</h4>
          <div style={{ width: '300px' }}>
            <SimpleSelect
              items={fruits}
              defaultValue={simple}
              onSelect={item => setSimple(item.value as string)}
              placeholder="Choose a fruit..."
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">Standard dropdown without search</p>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-700">Select (With Search)</h4>
          <div style={{ width: '300px' }}>
            <Select
              items={countries}
              defaultValue={withSearch}
              onSelect={item => setWithSearch(item.value as string)}
              allowSearch={true}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">Dropdown with search/filter capability</p>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-700">PortalSelect (Portal-based)</h4>
          <div style={{ width: '300px' }}>
            <PortalSelect
              value={portal}
              items={fruits}
              onSelect={item => setPortal(item.value as string)}
              placeholder="Choose a fruit..."
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">Portal-based positioning for better overflow handling</p>
        </div>
      </div>
    </div>
  )
}

export const VariantComparison: Story = {
  render: () => <VariantComparisonDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Interactive playground
const PlaygroundDemo = () => {
  const [selected, setSelected] = useState('apple')

  return (
    <div style={{ width: '350px' }}>
      <SimpleSelect
        items={fruits}
        defaultValue={selected}
        onSelect={item => setSelected(item.value as string)}
        placeholder="Select an option..."
      />
    </div>
  )
}

export const Playground: Story = {
  render: () => <PlaygroundDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story
