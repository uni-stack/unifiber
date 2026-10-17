import type { Context } from 'react'
import type { ContextReader } from '../fiber'
import type { Host } from '../host'
import * as host from '../host'

// Bound once: Metro's inline requires
const { isHidden } = host

export interface StyleSource {
    readonly name: string
    // bumps on every runtime change (theme, breakpoint, ...)
    epoch(): number
    readonly contexts?: ReadonlyArray<Context<any>>
    // cache key for a context value; default: the value itself. Stable scopes renamed in place need `scope?.name`
    contextKey?(context: Context<any>, value: unknown): unknown
    // undefined: none of these styles belong to this source
    resolve(props: Record<string, any>, read: ContextReader): Record<string, unknown> | undefined
}

export interface OwnerAdapter<Owner extends object = object> {
    readonly name: string
    // runs on every link: keep it to a property read or two
    gate(host: Host): boolean
    claim(host: Host): Owner | null
    attach(owner: Owner, source: StyleSource): void
    refresh(owner: Owner, source: StyleSource): void
}

export type OwnerRegistry = {
    link(host: Host | null | undefined): void
    refresh(hosts: ReadonlyArray<Host | null | undefined>): void
}

// An adapter that throws is disabled for the session and reported once
export const createOwnerRegistry = (
    source: StyleSource,
    adapters: ReadonlyArray<OwnerAdapter<any>>,
    onAdapterError?: (reason: string) => void,
): OwnerRegistry => {
    const disabledAdapters = new Set<OwnerAdapter>()
    const disable = (adapter: OwnerAdapter, error: unknown) => {
        disabledAdapters.add(adapter)
        onAdapterError?.(`adapter ${adapter.name} failed: ${String(error)}`)
    }
    // Not inline closures: a closure in link() makes Hermes allocate its environment on every call
    const attachOwner = (adapter: OwnerAdapter, host: Host) => {
        try {
            const owner = adapter.claim(host)

            if (owner) {
                adapter.attach(owner, source)
            }
        } catch (error) {
            disable(adapter, error)
        }
    }
    const refreshOwner = (adapter: OwnerAdapter, host: Host, seen: Set<object>) => {
        try {
            const owner = adapter.claim(host)

            if (owner && !seen.has(owner)) {
                seen.add(owner)
                adapter.attach(owner, source)
                adapter.refresh(owner, source)
            }
        } catch (error) {
            disable(adapter, error)
        }
    }

    return {
        link(host) {
            if (!host) {
                return
            }

            for (let i = 0; i < adapters.length; i++) {
                const adapter = adapters[i]!

                if (adapter.gate(host) && !disabledAdapters.has(adapter)) {
                    attachOwner(adapter, host)
                }
            }
        },
        refresh(hosts) {
            const seen = new Set<object>()

            for (let h = 0; h < hosts.length; h++) {
                const host = hosts[h]

                if (!host || isHidden(host)) {
                    continue
                }

                for (let i = 0; i < adapters.length; i++) {
                    const adapter = adapters[i]!

                    if (adapter.gate(host) && !disabledAdapters.has(adapter)) {
                        refreshOwner(adapter, host, seen)
                    }
                }
            }
        },
    }
}
