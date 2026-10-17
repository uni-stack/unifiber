import { createOwnerRegistry } from './adapters/registry'
import { animatedComponentOf, reanimatedCSSAdapter } from './adapters/reanimated'
import { getCreationStack, getOwners, verify } from './diagnostics'
import * as HostApi from './host'

export type { Host } from './host'
export type { Drift } from './diagnostics'
export type { ShadowNode } from './fiber'
export type { OwnerAdapter, OwnerRegistry, StyleSource } from './adapters/registry'

// Object literals, not classes: static methods on a Babel-transpiled class are slower on Hermes
export const Fiber = {
    getHostFor: HostApi.getHostFor,
    getShadowNodeFor: HostApi.getShadowNodeFor,
    getHostForInstanceHandle: HostApi.getHostForInstanceHandle,
    getContentContainerFor: HostApi.getContentContainerFor,

    getShadowNode: HostApi.getShadowNode,
    getShadowNodes: HostApi.getShadowNodes,
    getNativeTag: HostApi.getNativeTag,
    getParentHost: HostApi.getParentHost,

    isHidden: HostApi.isHidden,
    isMounted: HostApi.isMounted,
    isSuspended: HostApi.isSuspended,
    isFrozen: HostApi.isFrozen,
    isInHiddenActivity: HostApi.isInHiddenActivity,

    collectVisibleAncestors: HostApi.collectVisibleAncestors,
    collectAncestors: HostApi.collectAncestors,

    patchRenderedProps: HostApi.patchRenderedProps,

    verify,
    getOwners,
    getCreationStack,

    createOwnerRegistry,
}

export const Reanimated = {
    animatedComponentOf,
    cssAdapter: reanimatedCSSAdapter,
}
