import { query as consoleQuery } from './pets.openapi.yaml'

export const petQueryOptions = consoleQuery.pets.byPetId.get.queryOptions({
  input: { params: { petId: 1 } },
})

export const createPetMutationOptions = consoleQuery.pets.post.mutationOptions()
