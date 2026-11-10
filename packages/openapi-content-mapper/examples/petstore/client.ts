import { createClient } from '@dify/openapi-content-mapper'
import { api } from './pets.openapi.yaml'

export const client = createClient({ baseUrl: 'http://127.0.0.1:4317' })

// Hover, complete operation names, or deliberately introduce an invalid field here.
export async function example() {
  const pet = await api.pets.byPetId.get({ params: { petId: 1 } }, { client })
  const pets = await api.pets.get({ query: { status: 'available' } }, { client })
  return { pet, pets }
}
