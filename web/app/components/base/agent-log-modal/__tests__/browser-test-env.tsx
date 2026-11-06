import type { ReactElement } from 'react'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'

export async function renderAgentLog(ui: ReactElement) {
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
  const screen = await render(<QueryProvider>{ui}</QueryProvider>)
  return {
    queryClient,
    screen,
    rerender: (next: ReactElement) => screen.rerender(<QueryProvider>{next}</QueryProvider>),
  }
}
