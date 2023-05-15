import { Model, createServer } from 'miragejs'
import type { User } from '@/models/user'
import type { History } from '@/models/history'
import type { Log } from '@/models/log'
import { seedUser, seedHistory, seedLog } from '@/test/factories'


export function mockAPI() {
  if (process.env.NODE_ENV === 'development') {
    console.log('in development mode, starting mock server ... ')
    const server = createServer({
      environment: process.env.NODE_ENV,
      factories: {
        user: seedUser(),
        history: seedHistory(),
        log: seedLog(),
      },
      models: {
        user: Model.extend<Partial<User>>({}),
        history: Model.extend<Partial<History>>({}),
        log: Model.extend<Partial<Log>>({}),
      },
      routes() {
        this.namespace = '/api'
        this.get('/users', () => {
          return this.schema.all('user')
        })
        this.get('/histories', () => {
          return this.schema.all('history')
        })
        this.get('/logs', () => {
          return this.schema.all('log')
        })
      },
      seeds(server) {
        server.createList('user', 20)
        server.createList('history', 50)
        server.createList('log', 50)
      },
    })
    return server
  }
  console.log('Not in development mode, not starting mock server ... ')
  return null
}
