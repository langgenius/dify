import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { ApiError, createClient } from '@dify/openapi-content-mapper'
import { api as jsonApi } from './pets.openapi'
import { api } from './pets.openapi.yaml'

async function main() {
  const pets = [{ id: 1, name: 'Mochi', status: 'available' }]
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'GET' && url.pathname === '/pets') {
      res.end(
        JSON.stringify(
          pets.filter(
            (pet) =>
              !url.searchParams.has('status') || pet.status === url.searchParams.get('status'),
          ),
        ),
      )
      return
    }
    if (req.method === 'POST' && url.pathname === '/pets') {
      let body = ''
      for await (const chunk of req) body += chunk
      const input = JSON.parse(body)
      const pet = { id: pets.length + 1, name: input.name, status: input.status ?? 'available' }
      pets.push(pet)
      res.writeHead(201).end(JSON.stringify(pet))
      return
    }
    const pet = pets.find((pet) => url.pathname === `/pets/${pet.id}`)
    if (pet && req.method === 'DELETE') {
      pets.splice(pets.indexOf(pet), 1)
      res.writeHead(204).end()
      return
    }
    res.writeHead(pet ? 200 : 404).end(JSON.stringify(pet ?? { message: 'Pet not found' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert(address && typeof address !== 'string')
    const client = createClient({ baseUrl: `http://127.0.0.1:${address.port}` })
    assert.equal(
      (await jsonApi.pets.byPetId.get({ params: { petId: 1 } }, { client })).name,
      'Mochi',
    )
    // oxlint-disable-next-line no-console -- The executable demo reports HTTP results.
    console.log('GET:', await api.pets.byPetId.get({ params: { petId: 1 } }, { client }))
    // oxlint-disable-next-line no-console -- The executable demo reports HTTP results.
    console.log('POST:', await api.pets.post({ body: { name: '雪团' } }, { client }))
    // oxlint-disable-next-line no-console -- The executable demo reports HTTP results.
    console.log('QUERY:', await api.pets.get({ query: { status: 'available' } }, { client }))
    assert.equal(await api.pets.byPetId.delete({ params: { petId: 2 } }, { client }), undefined)
    try {
      await api.pets.byPetId.get({ params: { petId: 404 } }, { client })
      assert.fail('Expected 404')
    } catch (error) {
      assert(error instanceof ApiError)
      assert.equal(error.response.status, 404)
      // oxlint-disable-next-line no-console -- The executable demo reports HTTP results.
      console.log('ERROR:', error.response.status, error.data)
    }
    // oxlint-disable-next-line no-console -- The executable demo reports HTTP results.
    console.log('Passed: direct YAML import → typed SDK → real local HTTP server')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
