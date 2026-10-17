// isMounted vs isHidden, ~400 fibers deep. Hermes: HERMES=... node bench/metro.mjs bench/is-mounted.ts
declare const require: any
declare const print: any
import { Fiber, type Host } from '../src/index'

const log = typeof print === 'function' ? print : console.log
const now: () => number = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now()
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
require('../test/harness/stubs.cjs').install()
const React = require('react')
const ReactFabric = require('react-native-renderer')
const Scheduler = require('scheduler')
const h = React.createElement

const DEPTH = 200
const Wrap = ({ d, children }: any) => (d === 0 ? children : h(Wrap, { d: d - 1 }, h('RCTView', null, children)))
let instance: any = null
ReactFabric.render(h(Wrap, { d: DEPTH }, h(React.Suspense, { fallback: null }, h('RCTView', { ref: (r: any) => r && (instance = r) }))), 1, null, true)
Scheduler.unstable_flushAll()
const host = Fiber.getHostFor(instance) as Host

const PASSES = Number((globalThis as any).PASSES ?? 400)
let sink = 0
const time = (name: string, fn: () => boolean) => {
    for (let i = 0; i < PASSES * 10; i++) sink += fn() ? 1 : 0
    const runs: Array<number> = []
    for (let r = 0; r < 9; r++) {
        const start = now()
        for (let i = 0; i < PASSES * 10; i++) sink += fn() ? 1 : 0
        runs.push(((now() - start) * 1e6) / (PASSES * 10))
    }
    log(`${name.padEnd(28)} ${runs.sort((a, b) => a - b)[4]!.toFixed(0).padStart(6)} ns  -> ${fn()}`)
}
log(`depth ~${DEPTH * 2} fibers`)
time('isMounted(host)', () => Fiber.isMounted(host))
time('isHidden(host)', () => Fiber.isHidden(host))
log(`sink ${sink}`)
