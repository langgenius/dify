import type {
  AccessMatrixItem,
  AccessPolicy,
} from '@dify/contracts/api/console/workspaces/types.gen'

export type AccessRule = AccessMatrixItem & { policy: AccessPolicy }
