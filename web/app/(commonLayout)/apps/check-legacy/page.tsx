'use client'
import Header from './components/header'
// TODO: Filter
import List from './components/list'

const Page = () => {
  return (
    <div>
      <Header appNum={5} publishedNum={3}/>
      <div>
        <List list={[]} />
      </div>
    </div>
  )
}

export default Page
