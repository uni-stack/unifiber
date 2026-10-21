// A Host is the view's creation fiber behind an opaque type: no allocation, and stable identity (=== / WeakMap keys).
import type { FiberNode, RawFiber, ShadowNode } from './fiber'
import * as fiber from './fiber'

// Bound once: Metro's inline requires would turn each imported name used in a function into a require per call
const {
    committedOf,
    fiberOfInstance,
    firstHostBelow,
    hostAncestor,
    patchRenderedProps: patchFiberProps,
    raw,
    resolveHostFiber,
    shadowNodesOf,
} = fiber
const { HostComponent: HOST_COMPONENT, Offscreen: OFFSCREEN, Suspense: SUSPENSE, Activity: ACTIVITY } = fiber.Tag

declare const brand: unique symbol
export type Host = { readonly [brand]: 'Host' }

export const fiberOf = (host: Host): RawFiber => host as unknown as RawFiber

export const toHost = (fiber: RawFiber | FiberNode | null | undefined): Host | undefined =>
    ((fiber as RawFiber | null | undefined)?.stateNode?.canonical?.internalInstanceHandle ?? undefined) as Host | undefined

const resolveRefSlowly = (ref: unknown): RawFiber | undefined =>
    raw(resolveHostFiber(ref)) ?? (toHost(firstHostBelow(fiberOfInstance(ref))) as unknown as RawFiber | undefined)

// The fast path is inlined: legacy Hermes doesn't inline calls
export const getHostFor = (ref: unknown): Host | undefined => {
    const fiber = (ref as { __internalInstanceHandle?: RawFiber } | null | undefined)?.__internalInstanceHandle

    if (fiber !== undefined) {
        return fiber as unknown as Host
    }

    return resolveRefSlowly(ref) as unknown as Host | undefined
}

export const getShadowNodeFor = (ref: unknown): ShadowNode | undefined => {
    const fiber = (ref as { __internalInstanceHandle?: RawFiber } | null | undefined)?.__internalInstanceHandle

    if (fiber !== undefined) {
        return fiber.stateNode?.node
    }

    return resolveRefSlowly(ref)?.stateNode?.node
}

export const getHostForInstanceHandle = (handle: unknown): Host | undefined => toHost(handle as RawFiber | null | undefined)

// Not the first host below the scroll view: on iOS a refreshControl comes first
export const getContentContainerFor = (ref: any): Host | undefined => {
    const scroll = ref?.getInnerViewRef ? ref : (ref?.getNativeScrollRef?.() ?? ref?.getScrollResponder?.())

    return getHostFor(scroll?.getInnerViewRef?.())
}

export const getShadowNode = (host: Host): ShadowNode | undefined => fiberOf(host).stateNode?.node

// Two nodes only while a render is in flight; after a commit both halves share one
export const getShadowNodes = (host: Host, out: Array<ShadowNode> = []): Array<ShadowNode> => {
    shadowNodesOf(host as unknown as FiberNode, out)

    return out
}

export const getNativeTag = (host: Host): number | undefined => fiberOf(host).stateNode?.canonical?.nativeTag

export const getParentHost = (host: Host): Host | undefined => toHost(hostAncestor(host as unknown as FiberNode))

export const patchRenderedProps = (host: Host, patch: (props: Record<string, any>) => Record<string, any> | undefined): boolean =>
    patchFiberProps(host as unknown as FiberNode, patch)

export const HiddenBy = {
    None: 0,
    Suspense: 1,
    Freeze: 2,
    Activity: 4,
} as const

// `return` can point into either half of a pair; ask which half is committed only when they disagree
export const committedHalf = (fiber: RawFiber, differs: (a: RawFiber, b: RawFiber) => boolean): RawFiber | null => {
    const alternate = fiber.alternate

    if (!alternate || !differs(fiber, alternate)) {
        return fiber
    }

    return raw(committedOf(fiber as unknown as FiberNode)) ?? null
}

const hiddenStateDiffers = (a: RawFiber, b: RawFiber) => (a.memoizedState === null) !== (b.memoizedState === null)

// React's own visibility bit on the Offscreen instance: shared by both halves and flipped in the commit before refs
// detach, so it also holds inside a ref cleanup, where the committed half is still the old tree
const OFFSCREEN_VISIBLE = 1
const isOffscreenHidden = (offscreen: RawFiber): boolean => {
    const visibility = offscreen.stateNode?._visibility

    if (typeof visibility === 'number') {
        return (visibility & OFFSCREEN_VISIBLE) === 0
    }

    return committedHalf(offscreen, hiddenStateDiffers)?.memoizedState != null
}
const freezeDiffers = (a: RawFiber, b: RawFiber) => a.memoizedProps?.freeze !== b.memoizedProps?.freeze

// react-freeze: Freeze > Suspense > Suspender. The Suspender keeps stale props because it throws, so read Freeze's.
const isFrozenBoundary = (suspense: RawFiber) =>
    committedHalf(suspense.return as RawFiber, freezeDiffers)?.memoizedProps?.freeze === true

// Every hidden subtree sits under an Offscreen fiber with memoizedState set
export const getHiddenReasons = (host: Host): number => {
    let reasons = 0

    for (let current = fiberOf(host).return; current; current = current.return) {
        if (current.tag !== OFFSCREEN || !isOffscreenHidden(current)) {
            continue
        }

        const boundary = current.return

        if (boundary?.tag === ACTIVITY) {
            reasons |= HiddenBy.Activity
        } else if (boundary?.tag === SUSPENSE) {
            reasons |= isFrozenBoundary(boundary) ? HiddenBy.Freeze : HiddenBy.Suspense
        }
    }

    return reasons
}

// Any hidden Offscreen, as in collectVisibleAncestors. Stops at the first: the reason isn't needed
export const isHidden = (host: Host): boolean => {
    for (let current = fiberOf(host).return; current; current = current.return) {
        if (current.tag === OFFSCREEN && isOffscreenHidden(current)) {
            return true
        }
    }

    return false
}
export const isSuspended = (host: Host) => (getHiddenReasons(host) & HiddenBy.Suspense) !== 0
export const isFrozen = (host: Host) => (getHiddenReasons(host) & HiddenBy.Freeze) !== 0
export const isInHiddenActivity = (host: Host) => (getHiddenReasons(host) & HiddenBy.Activity) !== 0

const isHiddenOffscreen = (offscreen: RawFiber, boundaries: Map<RawFiber, boolean>): boolean => {
    let hidden = boundaries.get(offscreen)

    if (hidden === undefined) {
        hidden = isOffscreenHidden(offscreen)
        boundaries.set(offscreen, hidden)

        if (offscreen.alternate) {
            boundaries.set(offscreen.alternate, hidden)
        }
    }

    return hidden
}

// Hot loops below: indexed loops and writes, explicit null checks, no helper calls (legacy Hermes)
export const collectVisibleAncestors = (hosts: ReadonlyArray<Host | null | undefined>, visit: (host: Host) => void) => {
    const visibleByTag = new Map<number, boolean>()
    const boundaries = new Map<RawFiber, boolean>()
    const pending: Array<RawFiber> = []

    for (let h = 0; h < hosts.length; h++) {
        let visible = true
        let count = 0

        for (let current = hosts[h] as unknown as RawFiber | null | undefined; current != null; current = current.return) {
            if (current.tag === HOST_COMPONENT) {
                const stateNode = current.stateNode

                if (stateNode == null || stateNode.canonical == null) {
                    break
                }

                const answer = visibleByTag.get(stateNode.canonical.nativeTag)

                if (answer !== undefined) {
                    visible = answer
                    break
                }

                pending[count++] = current
            } else if (current.tag === OFFSCREEN && isHiddenOffscreen(current, boundaries)) {
                visible = false
                break
            }
        }

        for (let i = 0; i < count; i++) {
            const canonical = pending[i]!.stateNode.canonical

            visibleByTag.set(canonical.nativeTag, visible)

            if (visible && canonical.internalInstanceHandle != null) {
                visit(canonical.internalInstanceHandle as Host)
            }
        }
    }
}

// Hidden hosts included
export const collectAncestors = (hosts: ReadonlyArray<Host | null | undefined>, visit: (host: Host) => void) => {
    const visitedByTag = new Set<number>()

    for (let h = 0; h < hosts.length; h++) {
        for (let current = hosts[h] as unknown as RawFiber | null | undefined; current != null; current = current.return) {
            if (current.tag !== HOST_COMPONENT) {
                continue
            }

            const stateNode = current.stateNode

            if (stateNode == null || stateNode.canonical == null) {
                break
            }

            const canonical = stateNode.canonical

            if (visitedByTag.has(canonical.nativeTag)) {
                break
            }

            visitedByTag.add(canonical.nativeTag)

            if (canonical.internalInstanceHandle != null) {
                visit(canonical.internalInstanceHandle as Host)
            }
        }
    }
}
