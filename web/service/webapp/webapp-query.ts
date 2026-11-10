import type { RouterUtils } from '@orpc/tanstack-query'
import type { WebAppClient } from './index'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

export function createWebAppQuery(client: WebAppClient) {
  const query: RouterUtils<WebAppClient> = createTanstackQueryUtils(client, {
    path: ['webapp'],
    experimental_defaults: {
      account: {
        profile: {
          patch: {
            mutationOptions: {
              onSuccess: (_data, _variables, _result, context) =>
                context.client.invalidateQueries({ queryKey: query.account.profile.get.key() }),
            },
          },
        },
        password: {
          post: {
            mutationOptions: {
              onSuccess: (_data, _variables, _result, context) =>
                context.client.invalidateQueries({ queryKey: query.account.profile.get.key() }),
            },
          },
        },
      },
      me: {
        apps: {
          byAppId: {
            delete: {
              mutationOptions: {
                onSuccess: (_data, _variables, _result, context) =>
                  context.client.invalidateQueries({ queryKey: query.me.apps.key() }),
              },
            },
            favorite: {
              put: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _result, context) =>
                    context.client.invalidateQueries({ queryKey: query.me.apps.key() }),
                },
              },
              delete: {
                mutationOptions: {
                  onSuccess: (_data, _variables, _result, context) =>
                    context.client.invalidateQueries({ queryKey: query.me.apps.key() }),
                },
              },
            },
          },
        },
        connections: {
          byConnectionKey: {
            delete: {
              mutationOptions: {
                onSuccess: (_data, _variables, _result, context) =>
                  Promise.all([
                    context.client.invalidateQueries({ queryKey: query.me.connections.key() }),
                    context.client.invalidateQueries({ queryKey: query.me.apps.key() }),
                  ]),
              },
            },
          },
        },
      },
    },
  })
  return query
}
