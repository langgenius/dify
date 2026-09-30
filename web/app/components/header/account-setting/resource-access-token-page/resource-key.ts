import type { ResourceAccessTokenResourcePayload } from '@dify/contracts/api/console/resource-access-tokens/types.gen'

export const candidateKey = (candidate: ResourceAccessTokenResourcePayload) =>
  `${candidate.type}:${candidate.id}`
