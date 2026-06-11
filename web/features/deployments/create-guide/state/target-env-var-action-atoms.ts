'use client'

import type { EnvVarValueSelection } from '@/features/deployments/components/env-var-bindings'
import { atom } from 'jotai'
import { envVarValuesAtom } from './target-atoms'

export const setEnvVarAtom = atom(null, (get, set, {
  key,
  value,
}: {
  key: string
  value: EnvVarValueSelection
}) => {
  set(envVarValuesAtom, {
    ...get(envVarValuesAtom),
    [key]: value,
  })
})
