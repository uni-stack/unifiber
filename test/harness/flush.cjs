// Production has no act(). React 19.3+ schedules root work in a microtask, so the renderer gets a queue we can drain.
const path = require('path')
const { SCHEDULER } = require('./paths.cjs')

module.exports = () => {
    const microtasks = []
    const scheduler = require(path.join(SCHEDULER, 'unstable_mock.js'))

    return {
        load: (requireRenderer) => {
            const realQueueMicrotask = globalThis.queueMicrotask
            globalThis.queueMicrotask = (task) => microtasks.push(task)
            try {
                return requireRenderer()
            } finally {
                globalThis.queueMicrotask = realQueueMicrotask
            }
        },
        flush: () => {
            do {
                while (microtasks.length > 0) microtasks.shift()()
                scheduler.unstable_flushAll()
            } while (microtasks.length > 0)
        },
    }
}
