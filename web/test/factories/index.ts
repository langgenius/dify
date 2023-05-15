import { Factory } from 'miragejs'
import { faker } from '@faker-js/faker'

import type { History } from '@/models/history'
import type { User } from '@/models/user'
import type { Log } from '@/models/log'

export const seedHistory = () => {
    return Factory.extend<Partial<History>>({
        source() {
            return faker.address.streetAddress()
        },
        target() {
            return faker.address.streetAddress()
        },
    })
}

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

export const seedLog = () => {
    return Factory.extend<Partial<Log>>({
        get key() {
            return faker.datatype.uuid()
        },
        get conversationId() {
            return faker.datatype.uuid()
        },
        get question() {
            return faker.lorem.sentence()
        },
        get answer() {
            return faker.lorem.sentence()
        },
        get userRate() {
            return faker.datatype.number(5)
        },
        get adminRate() {
            return faker.datatype.number(5)
        }
    })
}