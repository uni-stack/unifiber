// React Native's own components in Node, built with RN's Babel preset and Metro's platform resolution.
// require('./rn.cjs')({ platform, mode }), one platform per process.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const Module = require('module')

const { RN, RN_VERSION, REACT, SCHEDULER, BABEL_PRESET: PRESET_DIR, BABEL_CORE: BABEL } = require('./paths.cjs')

module.exports = ({ platform = 'ios', mode = 'development' } = {}) => {
    process.env.NODE_ENV = mode
    // import cycles in RN probe `then` on half-initialized exports: noise
    const emitWarning = process.emitWarning
    process.emitWarning = (warning, ...args) =>
        String(warning).includes('inside circular dependency') ? undefined : emitWarning.call(process, warning, ...args)
    globalThis.__DEV__ = mode === 'development'
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.RN$Bridgeless = true
    globalThis.window = globalThis

    const { ops } = require('./stubs.cjs').install()
    installNativeModules(platform)

    const babel = require(BABEL)
    const preset = require(PRESET_DIR)
    const cacheDir = path.join(os.tmpdir(), 'unifiber-rn-cache', `${RN_VERSION}-${platform}-${mode}`)
    fs.mkdirSync(cacheDir, { recursive: true })

    const isRNSource = (file) =>
        (file.startsWith(RN + path.sep) || file.includes(`${path.sep}@react-native${path.sep}`)) &&
        !file.includes(`${path.sep}Renderer${path.sep}implementations${path.sep}`) &&
        !file.includes(`${path.sep}node_modules${path.sep}@babel${path.sep}`)

    const originalJs = Module._extensions['.js']
    Module._extensions['.js'] = function (module, filename) {
        if (!isRNSource(filename)) {
            return originalJs(module, filename)
        }
        const source = fs.readFileSync(filename, 'utf8')
        const key = crypto.createHash('sha1').update(filename).update(source).digest('hex')
        const cached = path.join(cacheDir, `${key}.js`)
        let code
        if (fs.existsSync(cached)) {
            code = fs.readFileSync(cached, 'utf8')
        } else {
            code = babel.transformSync(source, {
                filename,
                babelrc: false,
                configFile: false,
                compact: false,
                presets: [[preset, { dev: mode === 'development', disableImportExportTransform: false, unstable_transformProfile: 'hermes-stable' }]],
                plugins: [[require(path.join(PRESET_DIR, '..', '..', '@babel', 'plugin-transform-modules-commonjs')), { lazy: false }]].filter(() => false),
            }).code
            // atomic: parallel test processes share this cache
            const temp = `${cached}.${process.pid}.tmp`
            fs.writeFileSync(temp, code)
            fs.renameSync(temp, cached)
        }
        module._compile(code, filename)
    }

    const originalResolve = Module._resolveFilename
    const exts = [`.${platform}.js`, '.native.js', '.js', `.${platform}.ts`, '.ts', '.json']
    Module._resolveFilename = function (request, parent, isMain, options) {
        if (request === 'react' || request.startsWith('react/')) {
            return originalResolve.call(this, request.replace(/^react/, REACT), parent, isMain, options)
        }
        if (request === 'scheduler') {
            return mode === 'development' ? path.join(SCHEDULER, 'index.js') : path.join(SCHEDULER, 'unstable_mock.js')
        }
        if (/\.(png|jpg|gif)$/.test(request)) {
            return path.join(__dirname, 'asset-stub.cjs')
        }
        // RN <= 0.88 path, then 0.89+
        if (request === 'react-native/Libraries/ReactPrivate/ReactNativePrivateInitializeCore' || request === 'react-native/setup-env') {
            return path.join(__dirname, 'initialize-core-stub.cjs')
        }
        const base = request === 'react-native' ? path.join(RN, 'index') : request.startsWith('react-native/') ? path.join(RN, request.slice('react-native/'.length)) : null
        if (base || request.startsWith('.')) {
            const from = base ?? path.resolve(path.dirname(parent?.filename ?? __filename), request)
            for (const ext of exts) {
                if (fs.existsSync(from + ext)) return from + ext
            }
            for (const ext of exts) {
                if (fs.existsSync(path.join(from, 'index' + ext))) return path.join(from, 'index' + ext)
            }
        }
        return originalResolve.call(this, request, parent, isMain, options)
    }

    const React = require(REACT)
    const RNIndex = require(path.join(RN, 'index'))
    const productionQueue = require('./flush.cjs')()
    const ReactFabric = productionQueue.load(() => require(path.join(RN, 'Libraries', 'Renderer', 'shims', 'ReactFabric')))
    const ReactFabricImpl = ReactFabric.default ?? ReactFabric

    let nextRootTag = 1
    const render = (element, rootTag = nextRootTag++) => {
        if (mode === 'development') {
            React.act(() => {
                ReactFabricImpl.render(element, rootTag, null, true)
            })
        } else {
            ReactFabricImpl.render(element, rootTag, null, true)
            productionQueue.flush()
        }
        return rootTag
    }

    return { React, RN: RNIndex, render, act: React.act, ops, platform, rnVersion: require(path.join(RN, 'package.json')).version }
}

// every native module exists: methods are no-ops, constants are what RN reads at import
function installNativeModules(platform) {
    const window = { width: 390, height: 844, scale: 3, fontScale: 1 }
    const constants = {
        PlatformConstants: {
            isTesting: true,
            isDisableAnimations: true,
            reactNativeVersion: { major: 0, minor: 87, patch: 1, prerelease: null },
            forceTouchAvailable: false,
            osVersion: platform === 'ios' ? '27.0' : 36,
            systemName: platform === 'ios' ? 'iOS' : 'Android',
            interfaceIdiom: 'phone',
            Version: 36,
            Release: '16',
            Serial: 'unknown',
            Fingerprint: 'unifiber',
            Model: 'unifiber',
            uiMode: 'normal',
            Brand: 'unifiber',
            Manufacturer: 'unifiber',
        },
        DeviceInfo: { Dimensions: { window, screen: window, windowPhysicalPixels: window, screenPhysicalPixels: window } },
        I18nManager: { isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier: 'en_US' },
        StatusBarManager: { HEIGHT: 47, DEFAULT_BACKGROUND_COLOR: 0 },
        SourceCode: { scriptURL: 'http://localhost:8081/index.bundle' },
        Appearance: {},
    }
    const stub = (name) =>
        new Proxy(
            {},
            {
                get(target, key) {
                    if (key === 'getConstants') return () => constants[name] ?? {}
                    if (key === 'then') return undefined
                    if (typeof key === 'symbol') return undefined
                    if (constants[name] && key in constants[name]) return constants[name][key]
                    if (key === 'getColorScheme') return () => 'light'
                    if (key === 'isReduceMotionEnabled' || key === 'isScreenReaderEnabled') return (cb) => cb?.(false)
                    return target[key] ?? (target[key] = () => undefined)
                },
            },
        )
    const modules = new Map()
    const get = (name) => (modules.has(name) ? modules.get(name) : (modules.set(name, stub(name)), modules.get(name)))
    globalThis.__turboModuleProxy = get
    globalThis.nativeModuleProxy = new Proxy({}, { get: (_, name) => (typeof name === 'string' ? get(name) : undefined) })
    globalThis.nativeFabricUIManager.getRoot ??= () => null
    globalThis.__nativeComponentRegistry__hasComponent = () => true
}
