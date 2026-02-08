import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { z } from 'zod'
import withValidation from '.'

// Sample components to wrap with validation
type UserCardProps = {
  name: string
  email: string
  age: number
  role?: string
}

const UserCard = ({ name, email, age, role }: UserCardProps) => {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-lg font-semibold">{name}</h3>
      <div className="space-y-1 text-sm text-gray-600">
        <div>
          Email:
          {email}
        </div>
        <div>
          Age:
          {age}
        </div>
        {role && (
          <div>
            Role:
            {role}
          </div>
        )}
      </div>
    </div>
  )
}

type ProductCardProps = {
  name: string
  price: number
  category: string
  inStock: boolean
}

const ProductCard = ({ name, price, category, inStock }: ProductCardProps) => {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-lg font-semibold">{name}</h3>
      <div className="space-y-1 text-sm">
        <div className="text-xl font-bold text-green-600">
          $
          {price}
        </div>
        <div className="text-gray-600">
          Category:
          {category}
        </div>
        <div className={inStock ? 'text-green-600' : 'text-red-600'}>
          {inStock ? '✓ In Stock' : '✗ Out of Stock'}
        </div>
      </div>
    </div>
  )
}

// Create validated versions
const userSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
  age: z.number().min(0).max(150),
})

const productSchema = z.object({
  name: z.string().min(1, 'Product name required'),
  price: z.number().positive('Price must be positive'),
  category: z.string().min(1, 'Category required'),
  inStock: z.boolean(),
})

const ValidatedUserCard = withValidation(UserCard, userSchema)
const ValidatedProductCard = withValidation(ProductCard, productSchema)

const meta = {
  title: 'Base/Data Entry/WithInputValidation',
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Higher-order component (HOC) for wrapping components with Zod schema validation. Validates props before rendering and returns null if validation fails, logging errors to console.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// Valid data example
export const ValidData: Story = {
  render: () => (
    <div style={{ width: '400px' }}>
      <h3 className="mb-4 text-lg font-semibold">Valid Props (Renders Successfully)</h3>
      <ValidatedUserCard
        name="John Doe"
        email="john@example.com"
        age={30}
        role="Developer"
      />
    </div>
  ),
}

// Invalid email
export const InvalidEmail: Story = {
  render: () => (
    <div style={{ width: '400px' }}>
      <h3 className="mb-4 text-lg font-semibold">Invalid Email (Returns null)</h3>
      <p className="mb-4 text-sm text-gray-600">
        Check console for validation error. Component won't render.
      </p>
      <ValidatedUserCard
        name="John Doe"
        email="invalid-email"
        age={30}
        role="Developer"
      />
      <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
        ⚠️ Validation failed: Invalid email format
      </div>
    </div>
  ),
}

// Invalid age
export const InvalidAge: Story = {
  render: () => (
    <div style={{ width: '400px' }}>
      <h3 className="mb-4 text-lg font-semibold">Invalid Age (Returns null)</h3>
      <p className="mb-4 text-sm text-gray-600">
        Age must be between 0 and 150. Check console.
      </p>
      <ValidatedUserCard
        name="John Doe"
        email="john@example.com"
        age={200}
        role="Developer"
      />
      <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
        ⚠️ Validation failed: Age must be ≤ 150
      </div>
    </div>
  ),
}

// Product validation - valid
export const ValidProduct: Story = {
  render: () => (
    <div style={{ width: '400px' }}>
      <h3 className="mb-4 text-lg font-semibold">Valid Product</h3>
      <ValidatedProductCard
        name="Laptop Pro"
        price={1299}
        category="Electronics"
        inStock={true}
      />
    </div>
  ),
}

// Product validation - invalid price
export const InvalidPrice: Story = {
  render: () => (
    <div style={{ width: '400px' }}>
      <h3 className="mb-4 text-lg font-semibold">Invalid Price (Returns null)</h3>
      <p className="mb-4 text-sm text-gray-600">
        Price must be positive. Check console.
      </p>
      <ValidatedProductCard
        name="Laptop Pro"
        price={-100}
        category="Electronics"
        inStock={true}
      />
      <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
        ⚠️ Validation failed: Price must be positive
      </div>
    </div>
  ),
}

// Comparison: validated vs unvalidated
export const ValidationComparison: Story = {
  render: () => (
    <div style={{ width: '700px' }} className="space-y-6">
      <div>
        <h3 className="mb-4 text-lg font-semibold">Without Validation</h3>
        <div className="space-y-3">
          <UserCard
            name="John Doe"
            email="invalid-email"
            age={200}
            role="Developer"
          />
          <div className="text-xs text-gray-500">
            ⚠️ Renders with invalid data (no validation)
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="mb-4 text-lg font-semibold">With Validation (HOC)</h3>
        <div className="space-y-3">
          <ValidatedUserCard
            name="John Doe"
            email="invalid-email"
            age={200}
            role="Developer"
          />
          <div className="text-xs text-gray-500">
            ✓ Returns null when validation fails (check console)
          </div>
        </div>
      </div>
    </div>
  ),
}

// Real-world example - Form submission
export const FormSubmission: Story = {
  render: () => {
    const handleSubmit = (data: UserCardProps) => {
      console.log('Submitting:', data)
    }

    const validData: UserCardProps = {
      name: 'Jane Smith',
      email: 'jane@example.com',
      age: 28,
      role: 'Designer',
    }

    const invalidData: UserCardProps = {
      name: '',
      email: 'not-an-email',
      age: -5,
      role: 'Designer',
    }

    return (
      <div style={{ width: '600px' }} className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">Form Submission with Validation</h3>

        <div className="space-y-6">
          <div>
            <h4 className="mb-2 text-sm font-medium text-gray-700">Valid Data</h4>
            <ValidatedUserCard {...validData} />
            <button
              className="mt-3 w-full rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700"
              onClick={() => handleSubmit(validData)}
            >
              Submit Valid Data
            </button>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h4 className="mb-2 text-sm font-medium text-gray-700">Invalid Data</h4>
            <ValidatedUserCard {...invalidData} />
            <button
              className="mt-3 w-full rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
              onClick={() => handleSubmit(invalidData)}
            >
              Try to Submit Invalid Data
            </button>
            <div className="mt-2 text-xs text-red-600">
              Component returns null, preventing invalid data rendering
            </div>
          </div>
        </div>
      </div>
    )
  },
}

// Real-world example - API response validation
export const APIResponseValidation: Story = {
  render: () => {
    const mockAPIResponses = [
      {
        name: 'Laptop',
        price: 999,
        category: 'Electronics',
        inStock: true,
      },
      {
        name: 'Invalid Product',
        price: -50, // Invalid: negative price
        category: 'Electronics',
        inStock: true,
      },
      {
        name: '', // Invalid: empty name
        price: 100,
        category: 'Electronics',
        inStock: false,
      },
    ]

    return (
      <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">API Response Validation</h3>
        <p className="mb-4 text-sm text-gray-600">
          Only valid products render. Invalid ones return null (check console).
        </p>

        <div className="grid grid-cols-2 gap-4">
          {mockAPIResponses.map((product, index) => (
            <div key={index}>
              <ValidatedProductCard {...product} />
              {!product.name || product.price <= 0
                ? (
                    <div className="mt-2 text-xs text-red-600">
                      ⚠️ Validation failed for product
                      {' '}
                      {index + 1}
                    </div>
                  )
                : null}
            </div>
          ))}
        </div>
      </div>
    )
  },
}

// Real-world example - Configuration validation
export const ConfigurationValidation: Story = {
  render: () => {
    type ConfigPanelProps = {
      apiUrl: string
      timeout: number
      retries: number
      debug: boolean
    }

    const ConfigPanel = ({ apiUrl, timeout, retries, debug }: ConfigPanelProps) => (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-base font-semibold">Configuration</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">API URL:</span>
            <span className="font-mono">{apiUrl}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Timeout:</span>
            <span>
              {timeout}
              ms
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Retries:</span>
            <span>{retries}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Debug Mode:</span>
            <span>{debug ? '✓ Enabled' : '✗ Disabled'}</span>
          </div>
        </div>
      </div>
    )

    const configSchema = z.object({
      apiUrl: z.string().url('Must be valid URL'),
      timeout: z.number().min(0).max(30000),
      retries: z.number().min(0).max(5),
      debug: z.boolean(),
    })

    const ValidatedConfigPanel = withValidation(ConfigPanel, configSchema)

    const validConfig = {
      apiUrl: 'https://api.example.com',
      timeout: 5000,
      retries: 3,
      debug: true,
    }

    const invalidConfig = {
      apiUrl: 'not-a-url',
      timeout: 50000, // Too high
      retries: 10, // Too many
      debug: true,
    }

    return (
      <div style={{ width: '600px' }} className="space-y-6">
        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-700">Valid Configuration</h4>
          <ValidatedConfigPanel {...validConfig} />
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-700">Invalid Configuration</h4>
          <ValidatedConfigPanel {...invalidConfig} />
          <div className="mt-2 text-xs text-red-600">
            ⚠️ Validation errors: Invalid URL, timeout too high, too many retries
          </div>
        </div>
      </div>
    )
  },
}

// Usage documentation
export const UsageDocumentation: Story = {
  render: () => (
    <div style={{ width: '700px' }} className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-xl font-bold">withValidation HOC</h3>

      <div className="space-y-6">
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-900">Purpose</h4>
          <p className="text-sm text-gray-600">
            Wraps React components with Zod schema validation for their props.
            Returns null and logs errors if validation fails.
          </p>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-900">Usage Example</h4>
          <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
            {`import { z } from 'zod'
import withValidation from './withValidation'

// Define your component
const UserCard = ({ name, email, age }) => (
  <div>{name} - {email} - {age}</div>
)

// Define validation schema
const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().min(0).max(150),
})

// Wrap with validation
const ValidatedUserCard = withValidation(UserCard, schema)

// Use validated component
<ValidatedUserCard
  name="John"
  email="john@example.com"
  age={30}
/>`}
          </pre>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-900">Key Features</h4>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
            <li>Type-safe validation using Zod schemas</li>
            <li>Returns null on validation failure</li>
            <li>Logs validation errors to console</li>
            <li>Only validates props defined in schema</li>
            <li>Preserves all original props</li>
          </ul>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-900">Use Cases</h4>
          <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
            <li>API response validation before rendering</li>
            <li>Form data validation</li>
            <li>Configuration panel validation</li>
            <li>Preventing invalid data from reaching components</li>
          </ul>
        </div>
      </div>
    </div>
  ),
}

// Interactive playground
export const Playground: Story = {
  render: () => {
    return (
      <div style={{ width: '600px' }} className="space-y-6">
        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-700">Try Valid Data</h4>
          <ValidatedUserCard
            name="Alice Johnson"
            email="alice@example.com"
            age={25}
            role="Engineer"
          />
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-700">Try Invalid Data</h4>
          <ValidatedUserCard
            name="Bob"
            email="invalid-email"
            age={-10}
            role="Manager"
          />
          <p className="mt-2 text-xs text-gray-500">
            Open browser console to see validation errors
          </p>
        </div>
      </div>
    )
  },
}
