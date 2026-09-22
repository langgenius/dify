'use client'

import * as React from 'react'

const noop: typeof React.useLayoutEffect = () => {}

export const useIsoLayoutEffect = typeof document !== 'undefined' ? React.useLayoutEffect : noop
