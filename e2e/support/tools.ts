import { createApiContext, expectApiResponseOK } from './api'

export async function deleteBuiltinToolCredential(
  provider: string,
  credentialId: string,
): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(
      `/console/api/workspaces/current/tool-provider/builtin/${provider}/delete`,
      {
        data: { credential_id: credentialId },
      },
    )
    await expectApiResponseOK(
      response,
      `Delete built-in tool credential ${credentialId} for ${provider}`,
    )
  } finally {
    await ctx.dispose()
  }
}
