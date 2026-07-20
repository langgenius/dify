import type { AppInstance } from '@dify/contracts/enterprise/types.gen'

export type DeploymentActionAppInstance = Pick<AppInstance, 'id' | 'displayName' | 'description'>
