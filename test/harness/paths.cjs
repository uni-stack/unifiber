// UNIFIBER_RN=0.86 selects react-native 0.86; UNISTYLES_DIR points at a Unistyles package dir instead of the npm one
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const nodeModules = path.join(ROOT, 'node_modules')
const dir = (name) => fs.realpathSync(path.join(nodeModules, name))

const RN_PACKAGES = { '0.87': 'react-native', '0.86': 'react-native-0.86' }
const rnKey = process.env.UNIFIBER_RN ?? '0.87'

if (!RN_PACKAGES[rnKey]) {
    throw new Error(`UNIFIBER_RN=${rnKey}: supported ${Object.keys(RN_PACKAGES).join(', ')}`)
}

const RN = dir(RN_PACKAGES[rnKey])

module.exports = {
    ROOT,
    RN,
    RN_VERSION: require(path.join(RN, 'package.json')).version,
    REACT: dir('react'),
    SCHEDULER: dir('scheduler'),
    BABEL_PRESET: dir('@react-native/babel-preset'),
    BABEL_CORE: dir('@babel/core'),
    BABEL_RUNTIME: dir('@babel/runtime'),
    ESBUILD: dir('esbuild'),
    REACT_FREEZE: dir('react-freeze'),
    REANIMATED: { '4.7': dir('react-native-reanimated'), '4.5': dir('react-native-reanimated-4.5') },
    // realpath: /tmp is /private/tmp on macOS
    UNISTYLES: process.env.UNISTYLES_DIR ? fs.realpathSync(path.resolve(process.env.UNISTYLES_DIR)) : dir('react-native-unistyles'),
}
