import { redirect } from 'next/navigation'

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const Home = async ({ searchParams }: HomePageProps) => {
  const resolvedSearchParams = await searchParams
  const urlSearchParams = new URLSearchParams()

  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (value === undefined)
      return

    if (Array.isArray(value)) {
      value.forEach(item => urlSearchParams.append(key, item))
      return
    }

    urlSearchParams.set(key, value)
  })

  const queryString = urlSearchParams.toString()
  redirect(queryString ? `/apps?${queryString}` : '/apps')
}

export default Home
