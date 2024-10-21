'use client'
import React, { useEffect, useState } from 'react'
import { Github } from '@/app/components/base/icons/src/public/common'
import type { GithubRepo } from '@/models/common'

const getStar = async () => {
  const res = await fetch('https://api.github.com/repos/langgenius/dify')

  if (!res.ok)
    throw new Error('Failed to fetch data')

  return res.json()
}

const GithubStar = () => {
  const [githubRepo, setGithubRepo] = useState<GithubRepo>({ stargazers_count: 6000 })
  const [isFetched, setIsFetched] = useState(false)
  useEffect(() => {
    (async () => {
      try {
        if (process.env.NODE_ENV === 'development')
          return

        await setGithubRepo(await getStar())
        setIsFetched(true)
      }
      catch (e) {

      }
    })()
  }, [])

  if (!isFetched)
    return null

  return (
    <a></a>
  )
}

export default GithubStar
