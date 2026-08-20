import { useQuery } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useProviderContext } from '@/context/provider-context'
import { ProviderContextProvider } from '@/context/provider-context-provider'
import { consoleQuery } from '@/service/client'
import { commonQueryKeys } from '@/service/use-common'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { render } from '@/test/console/render'

function EducationProbe() {
  const { enableEducationPlan } = useProviderContext()
  useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: enableEducationPlan,
    }),
  )

  return <div>{enableEducationPlan ? 'education-enabled' : 'education-disabled'}</div>
}

describe('ProviderContextProvider', () => {
  it('does not enable education status requests outside Cloud edition', async () => {
    const { queryClient, wrapper } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'COMMUNITY' },
    })
    seedFeatures(queryClient, { education: { enabled: true } })
    queryClient.setQueryData(
      consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions().queryKey,
      { data: [], plugins: {} },
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
        input: { params: { model_type: ModelTypeEnum.textGeneration } },
      }),
      { data: [] },
    )
    queryClient.setQueryData(commonQueryKeys.retrievalMethods, { retrieval_method: [] })

    render(
      <ProviderContextProvider>
        <EducationProbe />
      </ProviderContextProvider>,
      { wrapper },
    )

    expect(await screen.findByText('education-disabled')).toBeInTheDocument()

    await waitFor(() => {
      const educationQuery = queryClient.getQueryState(
        consoleQuery.account.education.get.queryOptions().queryKey,
      )
      expect(educationQuery?.fetchStatus).toBe('idle')
    })
  })
})
