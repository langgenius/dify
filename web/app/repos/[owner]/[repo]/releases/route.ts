import { type NextRequest, NextResponse } from 'next/server'
import { Octokit } from '@octokit/core'
import { RequestError } from '@octokit/request-error'
import { GITHUB_ACCESS_TOKEN } from '@/config'

type Params = {
  owner: string,
  repo: string,
}

const octokit = new Octokit({
  auth: GITHUB_ACCESS_TOKEN,
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { owner, repo } = (await params)
  try {
    const releasesRes = await octokit.request('GET /repos/{owner}/{repo}/releases', {
      owner,
      repo,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    return NextResponse.json(releasesRes)
  }
  catch (error) {
    if (error instanceof RequestError)
      return NextResponse.json(error.response)
    else
      throw error
  }
}
