import type { GetWorkflowRunArchivesResponse } from '@dify/contracts/api/console/workflow-run-archives/types.gen'
import type { ConsolePolicies, ConsoleQuery } from './types'

export function workflowRunArchivePolicies(
  consoleQuery: ConsoleQuery,
): ConsolePolicies['workflowRunArchives'] {
  return {
    downloads: {
      post: {
        mutationOptions: {
          onSuccess: async (task, _variables, _onMutateResult, context) => {
            const queryKey = consoleQuery.workflowRunArchives.downloads.byDownloadId.get.queryKey({
              input: { params: { download_id: task.download_id } },
            })
            if (context.client.isFetching({ queryKey, exact: true }))
              await context.client.cancelQueries({ queryKey, exact: true })
            context.client.setQueryData(queryKey, task)
          },
        },
      },
    },
    byYear: {
      byMonth: {
        delete: {
          mutationOptions: {
            onSuccess: async (task, _variables, _onMutateResult, context) => {
              const queryKey = consoleQuery.workflowRunArchives.get.queryKey()
              const deletionStatus = task.status
              if (context.client.isFetching({ queryKey, exact: true }))
                await context.client.cancelQueries({ queryKey, exact: true })
              context.client.setQueryData<GetWorkflowRunArchivesResponse>(queryKey, (data) => {
                if (!data) return data

                if (deletionStatus === 'completed') {
                  const months = data.months.filter(
                    (archive) => archive.year !== task.year || archive.month !== task.month,
                  )
                  return {
                    months,
                    summary: {
                      archived_month_count: months.length,
                      workflow_run_count: months.reduce(
                        (count, archive) => count + archive.workflow_run_count,
                        0,
                      ),
                      archive_bytes: months.reduce(
                        (bytes, archive) => bytes + archive.archive_bytes,
                        0,
                      ),
                      latest_archived_at: months.reduce<string | null>(
                        (latest, archive) =>
                          archive.latest_archived_at &&
                          (!latest || archive.latest_archived_at > latest)
                            ? archive.latest_archived_at
                            : latest,
                        null,
                      ),
                    },
                  }
                }

                return {
                  ...data,
                  months: data.months.map((archive) =>
                    archive.year === task.year && archive.month === task.month
                      ? { ...archive, deletion_status: deletionStatus }
                      : archive,
                  ),
                }
              })
            },
            onSettled: (_data, _error, _variables, _onMutateResult, context) => {
              void context.client.invalidateQueries({
                queryKey: consoleQuery.workflowRunArchives.get.queryKey(),
              })
            },
          },
        },
      },
    },
  }
}
