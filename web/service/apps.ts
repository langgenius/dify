import { post } from './base'

type PublishToCreatorsPlatformResponse = {
  redirect_url: string
}

export const publishToCreatorsPlatform = ({
  appID,
}: {
  appID: string
}): Promise<PublishToCreatorsPlatformResponse> => {
  return post<PublishToCreatorsPlatformResponse>(`apps/${appID}/publish-to-creators-platform`, {
    body: {},
  })
}
