import type { BuiltinToolCredentialDeletePayload } from '@dify/contracts/api/console/workspaces/types.gen'
import { zPostWorkspacesCurrentToolProviderBuiltinByProviderDeleteResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { createConsoleApiContext, expectApiResponseOK } from './console-context'

export async function deleteBuiltinToolCredential(
  provider: string,
  credentialId: string,
): Promise<void> {
  const ctx = await createConsoleApiContext()
  try {
    const data = { credential_id: credentialId } satisfies BuiltinToolCredentialDeletePayload
    const response = await ctx.post(
      `/console/api/workspaces/current/tool-provider/builtin/${provider}/delete`,
      { data },
    )
    await expectApiResponseOK(
      response,
      `Delete built-in tool credential ${credentialId} for ${provider}`,
    )
    zPostWorkspacesCurrentToolProviderBuiltinByProviderDeleteResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}
