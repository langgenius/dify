'use client'

import { TanStackDevtools } from '@tanstack/react-devtools'
import { formDevtoolsPlugin } from '@tanstack/react-form-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import * as React from 'react'
import { IS_DEV } from '@/config'

export function TanStackDevtoolsWrapper() {
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
