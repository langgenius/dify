import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { RiCloudLine, RiCpuLine, RiDatabase2Line, RiLightbulbLine, RiRocketLine, RiShieldLine } from '@remixicon/react'
import { useState } from 'react'
import RadioCard from '.'

const meta = {
  title: 'Base/Data Entry/RadioCard',
  component: RadioCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Radio card component for selecting options with rich content. Features icon, title, description, and optional configuration panel when selected.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    icon: {
      description: 'Icon element to display',
    },
    iconBgClassName: {
      control: 'text',
      description: 'Background color class for icon container',
    },
    title: {
      control: 'text',
      description: 'Card title',
    },
    description: {
      control: 'text',
      description: 'Card description',
    },
    isChosen: {
      control: 'boolean',
      description: 'Whether the card is selected',
    },
    noRadio: {
      control: 'boolean',
      description: 'Hide the radio button indicator',
    },
  },
} satisfies Meta<typeof RadioCard>

export default meta
type Story = StoryObj<typeof meta>

// Single card demo
const RadioCardDemo = (args: any) => {
  const [isChosen, setIsChosen] = useState(args.isChosen || false)

  return (
    <div style={{ width: '400px' }}>
      <RadioCard
        {...args}
        isChosen={isChosen}
        onChosen={() => setIsChosen(!isChosen)}
      />
    </div>
  )
}

// Default state
export const Default: Story = {
  render: args => <RadioCardDemo {...args} />,
  args: {
    icon: <RiRocketLine className="h-5 w-5 text-purple-600" />,
    iconBgClassName: 'bg-purple-100',
    title: 'Quick Start',
    description: 'Get started quickly with default settings',
    isChosen: false,
    noRadio: false,
  },
}

// Selected state
export const Selected: Story = {
  render: args => <RadioCardDemo {...args} />,
  args: {
    icon: <RiRocketLine className="h-5 w-5 text-purple-600" />,
    iconBgClassName: 'bg-purple-100',
    title: 'Quick Start',
    description: 'Get started quickly with default settings',
    isChosen: true,
    noRadio: false,
  },
}

// Without radio indicator
export const NoRadio: Story = {
  render: args => <RadioCardDemo {...args} />,
  args: {
    icon: <RiRocketLine className="h-5 w-5 text-purple-600" />,
    iconBgClassName: 'bg-purple-100',
    title: 'Information Card',
    description: 'Card without radio indicator',
    noRadio: true,
  },
}

// With configuration panel
const WithConfigurationDemo = () => {
  const [isChosen, setIsChosen] = useState(true)

  return (
    <div style={{ width: '400px' }}>
      <RadioCard
        icon={<RiDatabase2Line className="h-5 w-5 text-blue-600" />}
        iconBgClassName="bg-blue-100"
        title="Database Storage"
        description="Store data in a managed database"
        isChosen={isChosen}
        onChosen={() => setIsChosen(!isChosen)}
        chosenConfig={(
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Region:</label>
              <select className="rounded border border-gray-300 px-2 py-1 text-xs">
                <option>US East</option>
                <option>EU West</option>
                <option>Asia Pacific</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Size:</label>
              <select className="rounded border border-gray-300 px-2 py-1 text-xs">
                <option>Small (10GB)</option>
                <option>Medium (50GB)</option>
                <option>Large (100GB)</option>
              </select>
            </div>
          </div>
        )}
      />
    </div>
  )
}

export const WithConfiguration: Story = {
  render: () => <WithConfigurationDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Multiple cards selection
const MultipleCardsDemo = () => {
  const [selected, setSelected] = useState('standard')

  const options = [
    {
      value: 'standard',
      icon: <RiRocketLine className="h-5 w-5 text-purple-600" />,
      iconBg: 'bg-purple-100',
      title: 'Standard',
      description: 'Perfect for most use cases',
    },
    {
      value: 'advanced',
      icon: <RiCpuLine className="h-5 w-5 text-blue-600" />,
      iconBg: 'bg-blue-100',
      title: 'Advanced',
      description: 'More features and customization',
    },
    {
      value: 'enterprise',
      icon: <RiShieldLine className="h-5 w-5 text-green-600" />,
      iconBg: 'bg-green-100',
      title: 'Enterprise',
      description: 'Full features with premium support',
    },
  ]

  return (
    <div style={{ width: '450px' }} className="space-y-3">
      {options.map(option => (
        <RadioCard
          key={option.value}
          icon={option.icon}
          iconBgClassName={option.iconBg}
          title={option.title}
          description={option.description}
          isChosen={selected === option.value}
          onChosen={() => setSelected(option.value)}
        />
      ))}
      <div className="mt-4 text-sm text-gray-600">
        Selected:
        {' '}
        <span className="font-semibold">{selected}</span>
      </div>
    </div>
  )
}

export const MultipleCards: Story = {
  render: () => <MultipleCardsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Cloud provider selection
const CloudProviderSelectionDemo = () => {
  const [provider, setProvider] = useState('aws')
  const [region, setRegion] = useState('us-east-1')

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Select Cloud Provider</h3>
      <div className="space-y-3">
        <RadioCard
          icon={<RiCloudLine className="h-5 w-5 text-orange-600" />}
          iconBgClassName="bg-orange-100"
          title="Amazon Web Services"
          description="Industry-leading cloud infrastructure"
          isChosen={provider === 'aws'}
          onChosen={() => setProvider('aws')}
          chosenConfig={(
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-700">Region</label>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={region}
                onChange={e => setRegion(e.target.value)}
              >
                <option value="us-east-1">US East (N. Virginia)</option>
                <option value="us-west-2">US West (Oregon)</option>
                <option value="eu-west-1">EU (Ireland)</option>
                <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
              </select>
            </div>
          )}
        />
        <RadioCard
          icon={<RiCloudLine className="h-5 w-5 text-blue-600" />}
          iconBgClassName="bg-blue-100"
          title="Microsoft Azure"
          description="Enterprise-grade cloud platform"
          isChosen={provider === 'azure'}
          onChosen={() => setProvider('azure')}
        />
        <RadioCard
          icon={<RiCloudLine className="h-5 w-5 text-red-600" />}
          iconBgClassName="bg-red-100"
          title="Google Cloud Platform"
          description="Scalable and reliable infrastructure"
          isChosen={provider === 'gcp'}
          onChosen={() => setProvider('gcp')}
        />
      </div>
    </div>
  )
}

export const CloudProviderSelection: Story = {
  render: () => <CloudProviderSelectionDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Deployment strategy
const DeploymentStrategyDemo = () => {
  const [strategy, setStrategy] = useState('rolling')

  return (
    <div style={{ width: '550px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-2 text-lg font-semibold">Deployment Strategy</h3>
      <p className="mb-4 text-sm text-gray-600">Choose how you want to deploy your application</p>
      <div className="space-y-3">
        <RadioCard
          icon={<RiRocketLine className="h-5 w-5 text-green-600" />}
          iconBgClassName="bg-green-100"
          title="Rolling Deployment"
          description="Gradually replace instances with zero downtime"
          isChosen={strategy === 'rolling'}
          onChosen={() => setStrategy('rolling')}
          chosenConfig={(
            <div className="rounded-lg bg-green-50 p-3 text-xs text-gray-700">
              ✓ Recommended for production environments
              <br />
              ✓ Minimal risk with automatic rollback
              <br />
              ✓ Takes 5-10 minutes
            </div>
          )}
        />
        <RadioCard
          icon={<RiCpuLine className="h-5 w-5 text-blue-600" />}
          iconBgClassName="bg-blue-100"
          title="Blue-Green Deployment"
          description="Switch between two identical environments"
          isChosen={strategy === 'blue-green'}
          onChosen={() => setStrategy('blue-green')}
          chosenConfig={(
            <div className="rounded-lg bg-blue-50 p-3 text-xs text-gray-700">
              ✓ Instant rollback capability
              <br />
              ✓ Requires double the resources
              <br />
              ✓ Takes 2-5 minutes
            </div>
          )}
        />
        <RadioCard
          icon={<RiLightbulbLine className="h-5 w-5 text-yellow-600" />}
          iconBgClassName="bg-yellow-100"
          title="Canary Deployment"
          description="Test with a small subset of users first"
          isChosen={strategy === 'canary'}
          onChosen={() => setStrategy('canary')}
          chosenConfig={(
            <div className="rounded-lg bg-yellow-50 p-3 text-xs text-gray-700">
              ✓ Test changes with real traffic
              <br />
              ✓ Gradual rollout reduces risk
              <br />
              ✓ Takes 15-30 minutes
            </div>
          )}
        />
      </div>
      <button className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Deploy with
        {' '}
        {strategy}
        {' '}
        strategy
      </button>
    </div>
  )
}

export const DeploymentStrategy: Story = {
  render: () => <DeploymentStrategyDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - Storage options
const StorageOptionsDemo = () => {
  const [storage, setStorage] = useState('ssd')

  const storageOptions = [
    {
      value: 'ssd',
      icon: <RiDatabase2Line className="h-5 w-5 text-purple-600" />,
      iconBg: 'bg-purple-100',
      title: 'SSD Storage',
      description: 'Fast and reliable solid state drives',
      price: '$0.10/GB/month',
      speed: 'Up to 3000 IOPS',
    },
    {
      value: 'hdd',
      icon: <RiDatabase2Line className="h-5 w-5 text-gray-600" />,
      iconBg: 'bg-gray-100',
      title: 'HDD Storage',
      description: 'Cost-effective magnetic disk storage',
      price: '$0.05/GB/month',
      speed: 'Up to 500 IOPS',
    },
    {
      value: 'nvme',
      icon: <RiDatabase2Line className="h-5 w-5 text-red-600" />,
      iconBg: 'bg-red-100',
      title: 'NVMe Storage',
      description: 'Ultra-fast PCIe-based storage',
      price: '$0.20/GB/month',
      speed: 'Up to 10000 IOPS',
    },
  ]

  const selectedOption = storageOptions.find(opt => opt.value === storage)

  return (
    <div style={{ width: '500px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">Storage Type</h3>
      <div className="space-y-3">
        {storageOptions.map(option => (
          <RadioCard
            key={option.value}
            icon={option.icon}
            iconBgClassName={option.iconBg}
            title={(
              <div className="flex items-center justify-between">
                <span>{option.title}</span>
                <span className="text-xs font-normal text-gray-500">{option.price}</span>
              </div>
            )}
            description={`${option.description} - ${option.speed}`}
            isChosen={storage === option.value}
            onChosen={() => setStorage(option.value)}
          />
        ))}
      </div>
      {selectedOption && (
        <div className="mt-4 rounded-lg bg-gray-50 p-4">
          <div className="text-sm text-gray-700">
            <strong>Selected:</strong>
            {' '}
            {selectedOption.title}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {selectedOption.price}
            {' '}
            •
            {selectedOption.speed}
          </div>
        </div>
      )}
    </div>
  )
}

export const StorageOptions: Story = {
  render: () => <StorageOptionsDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Real-world example - API authentication method
const APIAuthMethodDemo = () => {
  const [authMethod, setAuthMethod] = useState('api_key')
  const [apiKey, setApiKey] = useState('')

  return (
    <div style={{ width: '550px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-lg font-semibold">API Authentication</h3>
      <div className="space-y-3">
        <RadioCard
          icon={<RiShieldLine className="h-5 w-5 text-blue-600" />}
          iconBgClassName="bg-blue-100"
          title="API Key"
          description="Simple authentication using a secret key"
          isChosen={authMethod === 'api_key'}
          onChosen={() => setAuthMethod('api_key')}
          chosenConfig={(
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-700">Your API Key</label>
              <input
                type="password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="sk-..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
              <p className="text-xs text-gray-500">Keep your API key secure and never share it publicly</p>
            </div>
          )}
        />
        <RadioCard
          icon={<RiShieldLine className="h-5 w-5 text-green-600" />}
          iconBgClassName="bg-green-100"
          title="OAuth 2.0"
          description="Industry-standard authorization protocol"
          isChosen={authMethod === 'oauth'}
          onChosen={() => setAuthMethod('oauth')}
          chosenConfig={(
            <div className="rounded-lg bg-green-50 p-3">
              <p className="mb-2 text-xs text-gray-700">
                Configure OAuth 2.0 authentication for secure access
              </p>
              <button className="text-xs font-medium text-green-600 hover:underline">
                Configure OAuth Settings →
              </button>
            </div>
          )}
        />
        <RadioCard
          icon={<RiShieldLine className="h-5 w-5 text-purple-600" />}
          iconBgClassName="bg-purple-100"
          title="JWT Token"
          description="JSON Web Token based authentication"
          isChosen={authMethod === 'jwt'}
          onChosen={() => setAuthMethod('jwt')}
          chosenConfig={(
            <div className="rounded-lg bg-purple-50 p-3 text-xs text-gray-700">
              JWT tokens provide stateless authentication with expiration and refresh capabilities
            </div>
          )}
        />
      </div>
    </div>
  )
}

export const APIAuthMethod: Story = {
  render: () => <APIAuthMethodDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story

// Interactive playground
const PlaygroundDemo = () => {
  const [selected, setSelected] = useState('option1')

  return (
    <div style={{ width: '450px' }} className="space-y-3">
      <RadioCard
        icon={<RiRocketLine className="h-5 w-5 text-purple-600" />}
        iconBgClassName="bg-purple-100"
        title="Option 1"
        description="First option with icon and description"
        isChosen={selected === 'option1'}
        onChosen={() => setSelected('option1')}
      />
      <RadioCard
        icon={<RiDatabase2Line className="h-5 w-5 text-blue-600" />}
        iconBgClassName="bg-blue-100"
        title="Option 2"
        description="Second option with different styling"
        isChosen={selected === 'option2'}
        onChosen={() => setSelected('option2')}
        chosenConfig={(
          <div className="rounded bg-blue-50 p-2 text-xs text-gray-600">
            Additional configuration appears when selected
          </div>
        )}
      />
      <RadioCard
        icon={<RiCloudLine className="h-5 w-5 text-green-600" />}
        iconBgClassName="bg-green-100"
        title="Option 3"
        description="Third option to demonstrate selection"
        isChosen={selected === 'option3'}
        onChosen={() => setSelected('option3')}
      />
    </div>
  )
}

export const Playground: Story = {
  render: () => <PlaygroundDemo />,
  parameters: { controls: { disable: true } },
} as unknown as Story
