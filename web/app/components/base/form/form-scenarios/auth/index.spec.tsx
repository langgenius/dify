import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import AuthForm from './index'

const formSchemas = [{
  type: FormTypeEnum.textInput,
  name: 'apiKey',
  label: 'API Key',
  required: true,
}] as const

const renderWithQueryClient = (ui: Parameters<typeof render>[0]) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

describe('AuthForm', () => {
  it('should render configured fields', () => {
    renderWithQueryClient(<AuthForm formSchemas={[...formSchemas]} />)

    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should use provided default values', () => {
    renderWithQueryClient(<AuthForm formSchemas={[...formSchemas]} defaultValues={{ apiKey: 'value-123' }} />)

    expect(screen.getByDisplayValue('value-123')).toBeInTheDocument()
  })

  it('should render nothing when no schema is provided', () => {
    const { container } = renderWithQueryClient(<AuthForm formSchemas={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
