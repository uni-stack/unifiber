// A provider's other half keeps its old value, and a bailed-out subtree's `return` pointers can reach it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as U from '../src/fiber'

const require = createRequire(import.meta.url)
const mode = process.env.UNIFIBER_MODE ?? 'development'
const { React, render, act, View } = require('./harness/fabric.cjs')({ mode })
const h = React.createElement
const rerender = (element: any, tag: number) => (mode === 'development' ? act(() => render(element, tag)) : render(element, tag))

test('readContext / contextReaderFor: never the provider value of the stale half', () => {
    const Ctx = React.createContext('default')
    let reader: any = null
    let host: any = null
    class Reader extends React.Component {
        render() {
            return h(View, { ref: (r: any) => r && (host = r) })
        }
    }
    // `k` re-renders the memoized subtree so its halves swap
    const Content = React.memo(({ k }: any) => h(View, { testID: `content-${k}` }, h(Reader, { k, ref: (r: any) => r && (reader = r) })))
    const app = (value: string, n: number, k = 0) => h(View, { testID: `root-${n}` }, h(Ctx, { value }, h(Content, { k })))
    const tag = render(app('a', 0))
    const creation = host.__internalInstanceHandle
    const stale: Array<string> = []

    const steps: Array<[string, number]> = [['b', 0], ['c', 0], ['c', 1], ['d', 1], ['e', 1], ['e', 2], ['f', 2], ['f', 3], ['g', 3], ['g', 3]]
    for (const [n, [value, k]] of steps.entries()) {
        rerender(app(value, n + 1, k), tag)
        const reads = {
            'reader (committed)': U.contextReaderFor(reader, false)(Ctx),
            'host creation fiber': U.readContext(creation, Ctx),
            'host alternate': creation.alternate ? U.readContext(creation.alternate, Ctx) : value,
        }
        for (const [how, got] of Object.entries(reads)) if (got !== value) stale.push(`${value}: ${how} read ${got}`)
    }

    assert.deepEqual(stale, [])
})
