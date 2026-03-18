import Link from '@/next/link'

const Home = async () => {
  return (
    <div className="flex min-h-screen flex-col justify-center py-12 sm:px-6 lg:px-8">

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mt-10 text-center">
          <Link href="/apps">🚀</Link>
        </div>
      </div>
    </div>
  )
}

export default Home
