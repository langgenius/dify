import { Factory } from 'miragejs'
import { faker } from '@faker-js/faker'

import type { User } from '@/models/user'

export const seedUser = () => {
  return Factory.extend<Partial<User>>({
    firstName() {
      return faker.name.firstName()
    },
    lastName() {
      return faker.name.lastName()
    },
    name() {
      return faker.address.streetAddress()
    },
    phone() {
      return faker.phone.number()
    },
    email() {
      return faker.internet.email()
    },
    username() {
      return faker.internet.userName()
    },
    avatar() {
      return faker.internet.avatar()
    },
  })
}
