import React, { useState } from 'react'
import { Table } from 'antd'
import dayjs from 'dayjs'
const LogContent = (props) => {
  console.log(props)
  const { sources, logContents } = props
  const [currentSource, setCurrentSource] = useState()

  const column = [
    {
      title: 'Date',
      dataIndex: 'timestamp',
      customWidth: 150,
      render: ({ value }) => {
        return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
      },
    },
    {
      title: 'Massage',
      dataIndex: 'body',
    },
  ]

  return (
    <>
      <div className="flex flex-row items-center">
        {/* <span className="text-nowrap">Source：</span> */}
        {/* <Select
          options={sources?.map(item => ({ label: item, value: item }))}
          value={currentSource}
          onChange={value => setCurrentSource(value)}
        /> */}
      </div>
      {/* <div className="flex-grow flex-shrink overflow-hidden"></div> */}
      {logContents?.contents && <Table scroll={{ y: 500 }} columns={column} dataSource={logContents.contents} />}
    </>
  )
}
export default LogContent
