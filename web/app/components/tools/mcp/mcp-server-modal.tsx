'use client'
import type { MCPServerFormValue } from './mcp-server-form'
import type { MCPServerParam } from './mcp-server-param-item'
import type { MCPServerDetail } from '@/app/components/tools/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import { MCPServerForm } from './mcp-server-form'

type ModalProps = {
  appID: string
  latestParams?: MCPServerParam[]
  data?: MCPServerDetail
  show: boolean
  onHide: () => void
  appInfo?: {
    description?: string
  }
}

const MCPServerModal = ({ appID, latestParams = [], data, show, onHide, appInfo }: ModalProps) => {
  const queryClient = useQueryClient()
  const { mutateAsync: createMCPServer, isPending: creating } = useMutation(
    consoleQuery.apps.byAppId.server.post.mutationOptions(),
  )
  const { mutateAsync: updateMCPServer, isPending: updating } = useMutation(
    consoleQuery.apps.byAppId.server.put.mutationOptions(),
  )
  const invalidateMCPServerDetail = () =>
    queryClient.invalidateQueries({
      queryKey: consoleQuery.apps.byAppId.server.get.queryKey({
        input: { params: { app_id: appID } },
      }),
    })

  const submit = async ({ description, parameters }: MCPServerFormValue) => {
    if (!data) {
      const body: {
        description?: string
        parameters: Record<string, string>
      } = { parameters }

      if (description.trim()) body.description = description

      await createMCPServer({ params: { app_id: appID }, body })
    } else {
      await updateMCPServer({
        params: { app_id: appID },
        body: { id: data.id, parameters, description },
      })
    }
    invalidateMCPServerDetail()
    onHide()
  }

  return (
    <MCPServerForm
      show={show}
      editing={Boolean(data)}
      defaultDescription={data?.description || appInfo?.description || ''}
      defaultParameters={data?.parameters}
      latestParams={latestParams}
      pending={creating || updating}
      onHide={onHide}
      onSubmit={submit}
    />
  )
}

export default MCPServerModal
