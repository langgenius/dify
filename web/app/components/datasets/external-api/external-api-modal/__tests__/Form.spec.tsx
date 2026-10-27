import type { CreateExternalAPIReq, FormSchema } from '../../declarations'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Form from '../Form'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

// Mock context for i18n doc link

describe('Form', () => {
  const defaultFormSchemas: FormSchema[] = [
    {
      variable: 'name',
      type: 'text',
      label: { en_US: 'Name', zh_CN: '名称' },
      required: true,
    },
    {
      variable: 'endpoint',
      type: 'text',
      label: { en_US: 'API Endpoint', zh_CN: 'API 端点' },
      required: true,
    },
    {
      variable: 'api_key',
      type: 'secret',
      label: { en_US: 'API Key', zh_CN: 'API 密钥' },
      required: true,
    },
  ]

  const defaultValue: CreateExternalAPIReq = {
    name: '',
    settings: {
      endpoint: '',
      api_key: '',
    },
  }

  const defaultProps = {
    id: 'external-api-form',
    onSubmit: vi.fn(),
    value: defaultValue,
    onChange: vi.fn(),
    formSchemas: defaultFormSchemas,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('edits the API name, endpoint and secret while preserving all fields', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const Harness = () => {
      const [value, setValue] = useState(defaultValue)
      return (
        <Form
          {...defaultProps}
          value={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)
    await user.type(screen.getByLabelText(/name/i), 'Knowledge API')
    await user.type(screen.getByLabelText(/api endpoint/i), 'https://example.com/retrieval')
    const secret = screen.getByLabelText(/api key/i)
    expect(secret).toHaveAttribute('type', 'password')
    await user.type(secret, 'secret-key')
    expect(onChange).toHaveBeenLastCalledWith({
      name: 'Knowledge API',
      settings: { endpoint: 'https://example.com/retrieval', api_key: 'secret-key' },
    })
    expect(
      screen.getByRole('link', { name: 'dataset.externalAPIPanelDocumentation' }),
    ).toHaveAttribute('href', 'https://docs.example.com/use-dify/knowledge/external-knowledge-api')
  })
})
