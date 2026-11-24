import type { HumanInputMigrationDialogProps } from './migration-dialog'
import type { HumanInputCreationPolicy } from './policy'
import { createContext, use } from 'react'

export type HumanInputMigrationContextValue = {
  policy: HumanInputCreationPolicy
  canEdit: boolean
  pending: boolean
  helpLink?: string
  openMigrationDialog: (ownerId: string) => void
  releaseDialogOwner: (ownerId: string) => void
  dialog: Omit<HumanInputMigrationDialogProps, 'open' | 'pending'> & { ownerId: string | null }
}

export const HumanInputMigrationContext = createContext<HumanInputMigrationContextValue | null>(
  null,
)

export const useHumanInputMigration = () => use(HumanInputMigrationContext)
