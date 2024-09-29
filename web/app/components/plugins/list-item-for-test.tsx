import React from 'react'

type ListItemProps = {
  text: string
}

const ListItem: React.FC<ListItemProps> = ({ text }) => {
  return (
    <div>
      <p>{text}</p>
    </div>
  )
}

export default ListItem
