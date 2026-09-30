import type {
  ResourceAccessTokenResourcePayload,
  ResourceAccessTokenRowResponse,
} from '@dify/contracts/api/console/resource-access-tokens/types.gen'

export type DialogState =
  | {
      mode: 'create'
    }
  | {
      mode: 'edit'
      row: TokenTableRow
    }

export type ResourceCandidate = ResourceAccessTokenResourcePayload & {
  name: string
}

export type TokenTableRow = {
  tokenId: string
  name: string
  trackId: string
  maskedToken: string
  createdAt?: number | null
  relations: ResourceAccessTokenRowResponse[]
}
