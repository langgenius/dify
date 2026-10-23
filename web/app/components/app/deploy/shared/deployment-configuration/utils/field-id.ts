import type { CredentialSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { credentialSlotKey } from './workflow-deployment-input'

export function credentialFieldId(slot: CredentialSlot) {
  return `deployment-credential-${encodeURIComponent(credentialSlotKey(slot))}`
}

export function environmentVariableFieldId(workflowId: string, key: string) {
  return `deployment-env-${encodeURIComponent(JSON.stringify([workflowId, key]))}`
}

export type DeploymentFieldError = {
  fieldId: string
  message: string
}
