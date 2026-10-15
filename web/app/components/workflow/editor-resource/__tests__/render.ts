import type { RenderHookOptions, RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import type { EditorResource } from '../resource'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { useQueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { render, renderHook } from '@/test/console/render'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { EditorResourceScope } from '../provider'

type ResourceOption = { resource?: EditorResource }

function createWrapper({
  resource = { kind: 'app', appId: 'app-1', mode: 'workflow' },
  wrapper: Wrapper,
  ...options
}: ResourceOption & ConsoleQueryTestOptions & Pick<RenderOptions, 'wrapper'>) {
  const { wrapper: ConsoleWrapper, ...query } = createConsoleQueryWrapper(options)
  function ResourceFixture({ children }: { children: ReactNode }) {
    const client = useQueryClient()
    if (
      resource.kind === 'app' &&
      !client.getQueryData(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: resource.appId } } }),
      )
    )
      seedAppDetail(client, createAppDetailFixture({ id: resource.appId, mode: resource.mode }))
    return createElement(
      QueryClientTestProvider,
      { queryClient: client },
      createElement(EditorResourceScope, { identity: resource, children }),
    )
  }
  function EditorWrapper({ children }: { children: ReactNode }) {
    const content = createElement(ResourceFixture, { children })
    return createElement(
      ConsoleWrapper,
      undefined,
      Wrapper ? createElement(Wrapper, undefined, content) : content,
    )
  }
  return { ...query, wrapper: EditorWrapper }
}

export function renderEditor(
  ui: ReactElement,
  { resource, wrapper, ...options }: RenderOptions & ConsoleQueryTestOptions & ResourceOption = {},
) {
  const { wrapper: EditorWrapper, ...query } = createWrapper({ ...options, resource, wrapper })
  return { ...render(ui, { ...options, wrapper: EditorWrapper }), ...query }
}

export function renderEditorHook<Result, Props = void>(
  callback: (props: Props) => Result,
  {
    resource,
    wrapper,
    ...options
  }: RenderHookOptions<Props> & ConsoleQueryTestOptions & ResourceOption = {},
) {
  const { wrapper: EditorWrapper, ...query } = createWrapper({ ...options, resource, wrapper })
  return { ...renderHook(callback, { ...options, wrapper: EditorWrapper }), ...query }
}
