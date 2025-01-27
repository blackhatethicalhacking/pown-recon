const { Scheduler } = require('../../scheduler')
const { Transform } = require('../../transform')
const { DOMAIN_TYPE, EMAIL_TYPE } = require('../../types')

const PWNDB_ACCOUNT_TYPE = 'pwndb:account'

const scheduler = new Scheduler()

const pwndbSearch = class extends Transform {
    static get alias() {
        return ['pwndb_search', 'pds']
    }

    static get title() {
        return 'PwnDB Search'
    }

    static get description() {
        return 'Searching the PownDB database'
    }

    static get group() {
        return this.title
    }

    static get tags() {
        return ['ce']
    }

    static get types() {
        return [DOMAIN_TYPE, EMAIL_TYPE]
    }

    static get options() {
        return {}
    }

    static get priority() {
        return 1
    }

    static get noise() {
        return 1
    }

    async handle({ id: source = '', label = '', type = '' }) {
        const results = []

        let body

        switch (type) {
            case DOMAIN_TYPE:
                body = `luser=%25&domain=${encodeURIComponent(label)}&luseropr=1&domainopr=0&submitform=em`

                break

            case EMAIL_TYPE:
                const [user = '', domain = ''] = label.split('@')

                body = `luser=${encodeURIComponent(user)}&domain=${encodeURIComponent(domain)}&luseropr=1&domainopr=0&submitform=em`

                break

            default:
                if (label.indexOf('@') > 0) {
                    const [user = '', domain = ''] = label.split('@')

                    body = `luser=${encodeURIComponent(user)}&domain=${encodeURIComponent(domain)}&luseropr=1&domainopr=0&submitform=em`
                }
                else {
                    body = `luser=%25&domain=${encodeURIComponent(label)}&luseropr=1&domainopr=0&submitform=em`
                }
        }

        const { responseBody } = await scheduler.tryRequest(5, { method: 'POST', uri: 'http://pwndb2am4tzkvold.onion.pet/', body })

        const text = responseBody.toString()

        const preMatch = text.match(/<pre>([\w\W]+?)<\/pre>/)

        if (preMatch) {
            const reg = /\d[\W]?Array[\W]+?\(([\w\W]*?)\)/g

            let arrayMatch

            while ((arrayMatch = reg.exec(preMatch[1])) !== null) {
                const entry = {}

                let reg = /\[(id|luser|domain|password)\]\s=>\s(.*)/g

                let detailsMatch

                while ((detailsMatch = reg.exec(arrayMatch[1])) !== null) {
                    entry[detailsMatch[1]] = detailsMatch[2]
                }

                const { id: recordId, luser: user, domain, password } = entry

                results.push({ type: PWNDB_ACCOUNT_TYPE, label: `${recordId}@${user}@${domain}`, props: { recordId, user, domain, password }, edges: [source] })
            }
        }

        return results
    }
}

module.exports = { pwndbSearch }
