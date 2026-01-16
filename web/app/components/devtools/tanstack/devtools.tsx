'use client'

import { TanStackDevtools } from '@tanstack/react-devtools'
import { formDevtoolsPlugin } from '@tanstack/react-form-devtools'
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
import * as React from 'react'

export function TanStackDevtoolsWrapper() {
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
