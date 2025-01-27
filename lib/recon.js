const assert = require('assert')
const cytoscape = require('cytoscape')
const { EventEmitter } = require('events')
const { setInterval, clearInterval } = require('timers')

const { makeId } = require('./utils')
const { traverseFunctions } = require('./traverse')
const { isUrl, isEmail, isIpv4, isIpv6, isDomain } = require('./detect')

class Recon extends EventEmitter {
    constructor(options = {}) {
        super()

        const { cy, maxNodesWarn = 0, maxNodesCap = 0, ...settings } = options

        if (cy) {
            this.cy = cy
        }
        else {
            this.cy = cytoscape({
                ...settings,

                headless: true
            })
        }

        this.maxNodesWarn = maxNodesWarn
        this.maxNodesCap = maxNodesCap

        this.transforms = {}

        this.selection = this.cy.collection()
    }

    registerTransforms(transforms) {
        Object.entries(transforms).forEach(([name, transform]) => {
            this.transforms[name.toLowerCase()] = transform
        })
    }

    serialize() {
        return this.cy.json()
    }

    deserialize(input) {
        this.cy.json(input)
    }

    addNodes(nodes) {
        let collection = this.cy.collection()

        this.cy.startBatch()

        nodes.forEach(({ id, type, label, props, edges = [], ...data }) => {
            if (!id) {
                id = makeId(type, label)
            }

            let node = this.cy.getElementById(id)

            if (node.length) {
                let nodeData = node.data()

                try {
                    if (type) {
                        nodeData.type = type
                    }

                    if (label) {
                        nodeData.label = label
                    }

                    if (props) {
                        nodeData.props = { ...nodeData.props, ...props }
                    }

                    node.data({ ...nodeData, ...data })
                }
                catch (e) {
                    this.emit('error', e)

                    return
                }
            }
            else {
                if (process.env.NODE_ENV !== 'production') {
                    assert.ok(type, `Node type is not specified.`)
                }

                try {
                    node = this.cy.add({
                        group: 'nodes',
                        data: {
                            ...data,

                            id,
                            type,
                            label,
                            props
                        }
                    })
                }
                catch (e) {
                    this.emit('error', e)

                    return
                }
            }

            try {
                collection = collection.add(node)
            }
            catch (e) {
                this.emit('error', e)

                return
            }

            edges.forEach((edge) => {
                let source
                let type
                let data

                if (typeof(edge) === 'string') {
                    source = edge
                    type = ''
                    data = {}
                }
                else {
                    source = edge.source || ''
                    type = edge.type || ''
                    data = edge
                }

                const target = id

                try {
                    const edgeElement = this.cy.add({
                        group: 'edges',
                        data: {
                            id: `edge:${type}:${source}:${target}`,
                            source: source,
                            target: target,

                            ...data
                        }
                    })

                    collection = collection.add(edgeElement)
                }
                catch (e) {
                    this.emit('error', e)

                    return
                }
            })
        })

        this.cy.endBatch()

        return this.selection = collection.nodes()
    }

    removeNodes(nodes) {
        throw new Error(`Not implemented`) // TODO: add code here
    }

    select(...expressions) {
        return this.selection = this.cy.nodes(expressions.join(','))
    }

    unselect() {
        return this.selection = this.cy.collection()
    }

    traverse(...expressions) {
        const traversors = [].concat(...expressions.map((expression) => {
            return expression.split(/\|+/g)
                .map((part) => part.trim())
                .filter((part) => part)
                .map((part) => {
                    const [name, ...input] = part.split(' ')

                    return {
                        name: name.toLowerCase().trim() || '',
                        input: input.join(' ').trim() || '*'
                    }
                })
        }))

        this.selection = this.cy.elements()

        traversors.forEach(({ name, input }) => {
            for (let traverseFunction of Object.keys(traverseFunctions)) {
                if (traverseFunction.toLowerCase() === name) {
                    this.selection = this.selection[traverseFunction](input)

                    return
                }
            }

            throw new Error(`Unrecognized traverse function ${name}`)
        })

        return this.selection
    }

    untraverse() {
        return this.selection = this.cy.collection()
    }

    group(label, selection = this.selection) {
        const parentId = makeId('group', label)

        this.cy.add({
            data: {
                id: parentId,
                type: 'group',
                label: label,
                props: {}
            }
        })

        selection.move({ parent: parentId })
    }

    ungroup(selection = this.selection) {
        selection.move({ parent: null })

        // TODO: cleanup the parent if no longer required
    }

    measure(selection = this.selection) {
        selection
            .nodes()
            .forEach((node) => {
                node.data('weight', node.connectedEdges().length)
            })
    }

    unmeasure(selection = this.selection) {
        selection
            .nodes()
            .forEach((node) => {
                node.data('weight', 0)
            })
    }

    async transform(transformation, options = {}, settings = {}) {
        const { group = false, weight = false, filter, extract, maxNodesWarn: _maxNodesWarn, maxNodesCap: _maxNodesCap } = settings

        const maxNodesWarn = _maxNodesWarn || this.maxNodesWarn
        const maxNodesCap = _maxNodesCap || this.maxNodesCap

        let transformNames

        if (transformation === '*') {
            transformNames = Object.keys(this.transforms)
        }
        else {
            transformNames = [transformation.toLowerCase()]
        }

        let transforms = transformNames.map((transformName) => {
            if (!this.transforms.hasOwnProperty(transformName)) {
                throw new Error(`Unknown transform ${transformName}`)
            }

            const transform = new this.transforms[transformName]()

            const prefix = `${JSON.stringify(transform.constructor.title)} :::`

            transform.on('info', (...args) => {
                this.emit('info', prefix, ...args)
            })

            transform.on('warn', (...args) => {
                this.emit('warn', prefix, ...args)
            })

            transform.on('error', (...args) => {
                this.emit('error', prefix, ...args)
            })

            transform.on('debug', (...args) => {
                this.emit('debug', prefix, ...args)
            })

            return transform
        })

        let nodes = this.selection.map((node) => {
            return node.data()
        })

        if (transformation === '*') {
            const nodeTypes = [].concat(...Array.from(new Set(nodes.map(({ type, label }) => {
                const types = []

                if (type) {
                    types.push(type)
                }

                if (label) {
                    if (isUrl(label)) {
                        types.push('uri')
                    }
                    else
                    if (isEmail(label)) {
                        types.push('email')
                    }
                    else
                    if (isIpv4(label)) {
                        types.push('ipv4')
                    }
                    else
                    if (isIpv6(label)) {
                        types.push('ipv6')
                    }
                    else
                    if (isDomain(label)) {
                        types.push('domain')
                    }

                    // TODO: add additional auto types
                }

                return types
            }))))

            transforms = transforms.filter(({ constructor = {} }) => constructor.types.some((type) => nodeTypes.includes(type)))

            if (filter) {
                const { noise = 10, name, alias, title, tag } = filter

                transforms = transforms.filter(({ constructor = {} }) => constructor.noise <= noise)

                if (name || alias || title || tag) {
                    transforms = transforms.filter(({ constructor = {} }) => {
                        const a = name && name.test(constructor.name)
                        const b = alias && constructor.alias.some((alias) => alias.test(alias))
                        const c = title && title.test(constructor.title)
                        const d = tag && constructor.tags.some((tag) => tag.test(tag))

                        return a || b || c || d
                    })
                }
            }
        }

        if (extract) {
            const { property, prefix = '', suffix = '' } = extract

            if (property) {
                nodes = nodes.map(({ props, ...rest }) => {
                    let value

                    try {
                        value = property.split('.').reduce((o, i) => o[i], props)
                    }
                    catch (e) {
                        value = ''
                    }

                    const label = `${prefix}${value}${suffix}`

                    return { ...rest, props, label }
                })
            }
        }

        transforms.sort((a, b) => a.constructor.priority - b.constructor.priority)

        let results = await Promise.all(transforms.map(async(transform) => {
            const name = transform.constructor.title
            const quotedName = JSON.stringify(name)

            let actualNodes

            if (transformation === '*') {
                actualNodes = nodes.filter(({ type }) => transform.constructor.types.includes(type))
            }
            else {
                actualNodes = nodes
            }

            let step = 0
            let steps = 0

            const progressHandler = (s, ss) => {
                step = s
                steps = ss
            }

            transform.on('progress', progressHandler)

            this.emit('info', `Starting transform ${quotedName} on ${actualNodes.length} nodes...`)

            const interval = setInterval(() => {
                this.emit('info', `Transform ${quotedName} still running ${step}/${steps}...`)
            }, 10000)

            let results

            try {
                results = await transform.run(actualNodes, options)
            }
            catch (e) {
                results = []

                this.emit('warn', `Transform ${quotedName} failed`)
                this.emit('error', `${name}:`, e)
            }

            clearInterval(interval)

            transform.off('progress', progressHandler)

            this.emit('info', `Transform ${quotedName} finished with ${results.length} results`)

            if (results.length) {
                if (group) {
                    const { group, title, description } = transform.constructor

                    const label = group

                    const parentId = makeId('group', label)

                    results.unshift({ id: parentId, type: 'group', label, props: { group, title, description }, edges: [] })

                    results.forEach((result) => {
                        result.parent = parentId
                    })
                }
            }

            if (maxNodesWarn && results.length > maxNodesWarn) {
                this.emit('warn', `Transform ${quotedName} will add ${results.length} nodes`)
            }

            if (maxNodesCap && results.length > maxNodesCap) {
                this.emit('warn', `Transform ${quotedName} nodes capped to ${maxNodesCap}`)

                results = results.slice(0, maxNodesCap)
            }

            return results
        }))

        results = [].concat(...results)

        this.emit('warn', `Attempting to add ${results.length} elements`)

        const oldSelection = this.selection

        this.addNodes(results)

        if (weight) {
            this.measure(oldSelection)
        }

        return results
    }
}

module.exports = { Recon }
