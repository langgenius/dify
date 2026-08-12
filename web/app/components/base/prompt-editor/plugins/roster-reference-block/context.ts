import type { RosterReferenceBlockType } from '../../types'
import { createContext } from 'react'

export const RosterReferenceBlockContext = createContext<RosterReferenceBlockType | undefined>(
  undefined,
)
