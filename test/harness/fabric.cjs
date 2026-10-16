// React Native's Fabric renderer in Node, against a fake native side. require('./fabric.cjs')({ mode })
const path = require('path')
const Module = require('module')

const { RN, REACT, SCHEDULER } = require('./paths.cjs')

module.exports = ({ mode = 'development' } = {}) => {
    process.env.NODE_ENV = mode
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.__DEV__ = mode === 'development'

    const { privateInterface, ops, committed } = require('./stubs.cjs').install()

    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
        if (request === 'react') return originalLoad.call(this, REACT, parent, isMain)
        if (request === 'scheduler')
            return originalLoad.call(this, mode === 'development' ? SCHEDULER : path.join(SCHEDULER, 'unstable_mock.js'), parent, isMain)
        // RN <= 0.88 paths, then 0.89+ entry points
        if (request === 'react-native/Libraries/ReactPrivate/ReactNativePrivateInterface') return privateInterface
        if (request === 'react-native/react-private-interface') return privateInterface
        if (request === 'react-native/Libraries/ReactPrivate/ReactNativePrivateInitializeCore') return {}
        if (request === 'react-native/setup-env') return {}
        return originalLoad.call(this, request, parent, isMain)
    }

    const React = require(REACT)
    const file = mode === 'development' ? 'ReactFabric-dev.js' : 'ReactFabric-prod.js'
    const productionQueue = require('./flush.cjs')()
    const ReactFabric = productionQueue.load(() => require(path.join(RN, 'Libraries', 'Renderer', 'implementations', file)))

    let nextRootTag = 1
    const render = (element, rootTag = nextRootTag++) => {
        if (mode === 'development') {
            React.act(() => {
                ReactFabric.render(element, rootTag, null, true)
            })
        } else {
            ReactFabric.render(element, rootTag, null, true)
            productionQueue.flush()
        }
        return rootTag
    }

    const View = (props) => React.createElement('RCTView', props)

    return {
        React,
        ReactFabric,
        render,
        act: React.act,
        committed,
        ops,
        View,
        rnVersion: require(path.join(RN, 'package.json')).version,
        reactVersion: React.version,
    }
}
