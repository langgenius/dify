'use client'

import { TanStackDevtools } from '@tanstack/react-devtools'
import { formDevtoolsPlugin } from '@tanstack/react-form-devtools'

import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import { IS_DEV } from '@/config'

export const TanStackDevtoolsLoader = () => {
  if (!IS_DEV)
    return null

  return (
    <TanStackDevtools
      plugins={[
        // Query Devtools (Official Plugin)
        {
          name: 'React Query',
          render: () => <ReactQueryDevtoolsPanel />,
        },

        // Form Devtools (Official Plugin)
        formDevtoolsPlugin(),
      ]}
    />
  )
}
