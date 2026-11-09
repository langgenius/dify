import type { HumanInputCreationPolicy } from './policy'
import { createContext, use } from 'react'

export type HumanInputMigrationContextValue = {
  policy: HumanInputCreationPolicy
  canEdit: boolean
  pending: boolean
  helpLink?: string
  openMigrationDialog: () => void
}

export const HumanInputMigrationContext = createContext<HumanInputMigrationContextValue | null>(
  null,
)

export const useHumanInputMigration = () => use(HumanInputMigrationContext)
