const querystring = require('querystring')

const { Scheduler } = require('../../scheduler')
const { Transform } = require('../../transform')
const { BRAND_TYPE, ORG_TYPE, DOMAIN_TYPE, IPV4_TYPE, PORT_TYPE } = require('../../types')

const scheduler = new Scheduler()

class ShodanTransform extends Transform {
    getQuery() {
        throw new Error(`Not implemented`)
    }

    filterMatch() {
        return true
    }

    async handle({ id: source = '', label = '' }, { shodanKey = process.env.SHODAN_KEY, ...options }) {
        if (!shodanKey) {
            throw new Error(`No shodan key supplied.`)
        }

        const results = []

        let page = 1
        let count = 0

        while (true) {
            const query = querystring.stringify({
                key: shodanKey,
                query: this.getQuery(label, options),
                page: page
            })

            this.info(`Retrieving shodan page ${page}`)

            const { responseBody } = await scheduler.tryFetch(`https://api.shodan.io/shodan/host/search?${query}`)

            const { matches = [], total } = JSON.parse(responseBody.toString())

            if (!matches.length) {
                break
            }

            matches.forEach((match) => {
                if (!this.filterMatch(label, match)) {
                    return
                }

                const { ip_str: ipv4, port, ssl, hostnames } = match

                const ipv4Id = this.makeId(IPV4_TYPE, ipv4)

                results.push({ id: ipv4Id, type: IPV4_TYPE, label: ipv4, props: { ipv4 }, edges: [source] })

                const portLabel = `${port}/TCP`

                const portId = this.makeId(PORT_TYPE, portLabel)

                results.push({ id: portId, type: PORT_TYPE, label: portLabel, props: { port, ssl: ssl ? true : false }, edges: [ipv4Id] })

                hostnames.forEach((domain) => {
                    results.push({ type: DOMAIN_TYPE, label: domain, props: { domain }, edges: [ipv4Id] })
                })
            })

            count += matches.length

            if (count >= total) {
                break
            }

            page += 1
        }

        return results
    }
}

const shodanOrgSearch = class extends ShodanTransform {
    static get alias() {
        return ['shodan_org_search', 'sos']
    }

    static get title() {
        return 'Shodan ORG Search'
    }

    static get description() {
        return 'Performs search using ORG filter.'
    }

    static get group() {
        return this.title
    }

    static get tags() {
        return ['ce']
    }

    static get types() {
        return [BRAND_TYPE, ORG_TYPE]
    }

    static get options() {
        return {
            shodanKey: {
                type: 'string',
                description: 'Shodan API key.'
            },

            extraQuery: {
                type: 'string',
                description: 'Extra query.'
            }
        }
    }

    static get priority() {
        return 1
    }

    static get noise() {
        return 50 // brand and org types can be quite noisy
    }

    getQuery(label, { extraQuery = '' }) {
        return `org:"${label}" ${extraQuery}`
    }
}

const shodanSslSearch = class extends ShodanTransform {
    static get alias() {
        return ['shodan_ssl_search', 'sss']
    }

    static get title() {
        return 'Shodan SSL Search'
    }

    static get description() {
        return 'Performs search using SSL filter.'
    }

    static get group() {
        return this.title
    }

    static get tags() {
        return ['ce']
    }

    static get types() {
        return [DOMAIN_TYPE]
    }

    static get options() {
        return {
            shodanKey: {
                type: 'string',
                description: 'Shodan API key.'
            },

            extraQuery: {
                type: 'string',
                description: 'Extra query.'
            }
        }
    }

    static get priority() {
        return 1
    }

    static get noise() {
        return 9
    }

    getQuery(label, { extraQuery = '' }) {
        return `ssl:"${label}" ${extraQuery}`
    }

    filterMatch(label, match) {
        const { ssl = {} } = match
        const { cert = {} } = ssl
        const { extensions = [], subject = {} } = cert

        const search = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

        const regex = new RegExp(`(^${search}$|\\.${search}$)`)

        const matchesExtensions = extensions.some(({ data }) => regex.test(data || ''))
        const matchesSubject = regex.test(subject.CN || '')

        return matchesExtensions || matchesSubject
    }
}

module.exports = { shodanOrgSearch, shodanSslSearch }
