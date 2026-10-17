// Keeps Reanimated's CSS style copy (`_cssStyle`) in sync with native-only style updates.
// Private fields are pinned by test/reanimated-contract.test.ts for 4.5 and 4.7.
import type { Host } from '../host'
import type { OwnerAdapter, StyleSource } from './registry'
import * as fiber from '../fiber'

// Bound once: Metro's inline requires
const { contextReaderFor } = fiber
const CLASS_COMPONENT = fiber.Tag.ClassComponent

type CSSManagerLike = { update(style: Record<string, unknown>, props?: Record<string, unknown>): void }

type AnimatedComponentLike = {
    props: Record<string, any>
    _cssStyle: Record<string, unknown>
    _CSSManager?: CSSManagerLike
    _updateStyles(props: Record<string, any>): void
    shouldComponentUpdate(nextProps: Record<string, any>, ...rest: Array<unknown>): boolean
    [STATE]?: AttachedState
}

type AttachedState = {
    source: StyleSource
    original: (props: Record<string, any>) => void
    originalShouldUpdate: AnimatedComponentLike['shouldComponentUpdate']
    rendering: boolean
    styleProp: unknown
    epoch: number
    contextKeys: Array<unknown>
    fresh: Record<string, unknown> | undefined
}

// Symbol.for: two copies of unifiber in one bundle never wrap a component twice
const STATE = Symbol.for('unifiber.reanimated.css')

const hasCSSConfig = (cssStyle: Record<string, unknown>) => {
    for (const key in cssStyle) {
        if (key.startsWith('transition') || key.startsWith('animation')) {
            return true
        }
    }

    return false
}

// Deepest case: ScrollView with refreshControl on Android, 6-7 fibers
const MAX_OWNER_DEPTH = 12

// The class whose `_componentRef` is this host's public instance. Lists don't match: their ref isn't a host.
export const animatedComponentOf = (host: Host | null | undefined): AnimatedComponentLike | null => {
    const fiber = host as any

    if (fiber?.memoizedProps?.collapsable !== false) {
        return null
    }

    const publicInstance = fiber.stateNode?.canonical?.publicInstance

    if (!publicInstance) {
        return null
    }

    let current = fiber.return

    for (let depth = 0; current && depth < MAX_OWNER_DEPTH; depth++) {
        if (current.tag === CLASS_COMPONENT && current.stateNode?._componentRef === publicInstance) {
            return isAnimatedComponent(current.stateNode) ? current.stateNode : null
        }

        current = current.return
    }

    return null
}

const isAnimatedComponent = (owner: any): owner is AnimatedComponentLike =>
    typeof owner?._updateStyles === 'function' &&
    typeof owner.shouldComponentUpdate === 'function' &&
    owner._cssStyle !== null &&
    typeof owner._cssStyle === 'object'

function updateStylesThroughSource(this: AnimatedComponentLike, props: Record<string, any>) {
    const state = this[STATE]!

    state.original.call(this, props)

    if (!hasCSSConfig(this._cssStyle)) {
        return
    }

    const epoch = state.source.epoch()
    const read = contextReaderFor(this, state.rendering)
    const contexts = state.source.contexts ?? []
    let contextChanged = false

    for (let i = 0; i < contexts.length; i++) {
        const context = contexts[i]!
        const value = read(context)
        const key = state.source.contextKey ? state.source.contextKey(context, value) : value

        if (state.contextKeys[i] !== key) {
            state.contextKeys[i] = key
            contextChanged = true
        }
    }

    if (contextChanged || state.styleProp !== props.style || state.epoch !== epoch) {
        state.fresh = state.source.resolve(props, read)
        state.styleProp = props.style
        state.epoch = epoch
    }

    const fresh = state.fresh

    if (!fresh) {
        return
    }

    // only the keys Reanimated kept: animated styles were split out of _cssStyle
    for (const key in this._cssStyle) {
        if (key in fresh) {
            this._cssStyle[key] = fresh[key]
        }
    }
}

// Marks the render phase, where context must be read from React's stack
function shouldUpdateMarkingRender(this: AnimatedComponentLike, ...args: [Record<string, any>, ...Array<unknown>]) {
    const state = this[STATE]!

    state.rendering = true

    try {
        return state.originalShouldUpdate.apply(this, args)
    } finally {
        state.rendering = false
    }
}

export const reanimatedCSSAdapter: OwnerAdapter<AnimatedComponentLike> = {
    name: 'react-native-reanimated/css',
    gate: (host: Host) => (host as unknown as fiber.RawFiber).memoizedProps?.collapsable === false,
    claim: animatedComponentOf,
    attach: (owner, source) => {
        if (owner[STATE]) {
            return
        }

        owner[STATE] = {
            source,
            original: owner._updateStyles,
            originalShouldUpdate: owner.shouldComponentUpdate,
            rendering: false,
            styleProp: undefined,
            epoch: -1,
            contextKeys: [],
            fresh: undefined,
        }
        owner._updateStyles = updateStylesThroughSource
        owner.shouldComponentUpdate = shouldUpdateMarkingRender
    },
    refresh: (owner) => {
        // not mounted yet
        if (typeof owner._CSSManager?.update !== 'function') {
            return
        }

        owner._updateStyles(owner.props)
        owner._CSSManager.update(owner._cssStyle, owner.props)
    },
}
