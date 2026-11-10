import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import DebugConfigurationContext from '@/context/debug-configuration'
import { createDebugConfigurationFixture } from '@/test/fixtures/debug-configuration'

export function renderWithDebugConfiguration(
  ui: ReactElement,
  overrides: Parameters<typeof createDebugConfigurationFixture>[0] = {},
) {
  const value = createDebugConfigurationFixture(overrides)
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <DebugConfigurationContext.Provider value={value}>
        {children}
      </DebugConfigurationContext.Provider>
    ),
  })
}
