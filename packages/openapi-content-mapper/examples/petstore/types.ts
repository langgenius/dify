import type { Inputs, Outputs, Schemas } from './pets.openapi.yaml'

// Shared models can be used in component props or local state.
export type Pet = Schemas['Pet']

// Inline request bodies and decoded responses follow the API member paths.
export type CreatePetBody = Inputs['pets']['post']['body']
export type GetPetInput = Inputs['pets']['byPetId']['get']
export type PetList = Outputs['pets']['get']

// List input is optional, so remove undefined before accessing its query group.
export type ListQuery = NonNullable<Inputs['pets']['get']>['query']

// A compatibility module can keep an existing export name and request envelope.
// Consumers keep importing it from the same module during migration.
export type GetPetsByPetIdData = {
  body?: never
  path: GetPetInput['params']
  query?: never
  url: '/pets/{petId}'
}

export type GetPetsByPetIdResponse = Outputs['pets']['byPetId']['get']
