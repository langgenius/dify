import type { EnvironmentVariableItemResponse } from '@dify/contracts/api/console/apps/types.gen'
import { createAlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'

export type ExportPayload = EnvironmentVariableItemResponse[] | null

export function createAppInfoDialogHandles() {
  return {
    edit: createDialogHandle(),
    duplicate: createDialogHandle(),
    switchApp: createDialogHandle(),
    importDSL: createDialogHandle(),
    delete: createAlertDialogHandle(),
    export: createAlertDialogHandle<ExportPayload>(),
  }
}

export type AppInfoDialogHandles = ReturnType<typeof createAppInfoDialogHandles>
