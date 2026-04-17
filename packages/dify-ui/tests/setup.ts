import { cleanup } from '@testing-library/react'
import { act } from 'react'

import '@testing-library/jest-dom/vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => {
    cleanup()
  })
})
