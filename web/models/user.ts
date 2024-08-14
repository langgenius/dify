export type User = {
  id: string
  firstName: string
  lastName: string
  name: string
  phone: string
  username: string
  email: string
  avatar: string
}

export type UserResponse = {
  users: User[]
}

export const fetchUsers = (url: string) =>
  fetch(url).then<UserResponse>(r => r.json())
