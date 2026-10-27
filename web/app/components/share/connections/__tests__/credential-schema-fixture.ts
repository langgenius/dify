import type { ReactElement } from 'react'
import type { FormSchema } from '@/app/components/base/form/types'
import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { createQueryClientWrapper } from '@/test/console/query-client'

export function renderConnectionUi(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(ui, { wrapper: createQueryClientWrapper(queryClient) })
}

const required = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() ? undefined : 'Credential is required'

export const credentialSchemas: FormSchema[] = [
  {
    name: 'api_key',
    label: 'share.connections.setup.apiKey',
    type: FormTypeEnum.secretInput,
    placeholder: 'share.connections.apiKeys.newKeyPlaceholder',
    required: true,
    validators: { onMount: required, onChange: required, onBlur: required },
  },
]
