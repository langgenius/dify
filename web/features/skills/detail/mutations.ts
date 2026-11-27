import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'

export type SkillDraftMutationCoordinator = {
  latestDetail: SkillDetailResponse | undefined
  queue: Promise<void>
  skillId: string
}

export function runSkillDraftMutation(
  coordinator: SkillDraftMutationCoordinator,
  mutation: (expectedUpdatedAt: number) => Promise<SkillDetailResponse>,
) {
  const operation = coordinator.queue.then(async () => {
    const latestDetail = coordinator.latestDetail
    if (!latestDetail) throw new Error('skill detail is required')

    const nextDetail = await mutation(latestDetail.updated_at)
    if (!coordinator.latestDetail || nextDetail.updated_at >= coordinator.latestDetail.updated_at)
      coordinator.latestDetail = nextDetail

    return nextDetail
  })
  coordinator.queue = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}
