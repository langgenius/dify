'use client'

import { useCreateGuideDslModel } from '../../../models/dsl'

export function useDslUnsupportedMode() {
  return useCreateGuideDslModel().dslUnsupportedMode
}
