import { createBenchmarkBuilder as createEditor } from '../../../src/research-benchmark.js'
import { invariant } from '../../../src/benchmark/prompts.mjs'
import { createBenchmarkStore } from './legacy-benchmark-store.mjs'

// Historical host fixture. The standalone editor receives only the project
// store interface; this adapter also stops old chunked writes after a switch.
export function createBenchmarkBuilder({ account, projectStore, ...options }) {
  let epoch = 0
  const assertCurrent = ticket => invariant(ticket === epoch, 'The project changed while working. Continue in the current project.')
  const legacyStore = Object.fromEntries(['read', 'save'].map(method => [method, async (...args) => {
    const ticket = epoch
    const scopedAccount = Object.fromEntries(['getSetting', 'putSetting'].map(name => [name, account?.[name] && (async (...values) => {
      assertCurrent(ticket)
      const result = await account[name](...values)
      assertCurrent(ticket)
      return result
    })]))
    return createBenchmarkStore(scopedAccount)[method](...args)
  }]))
  const view = createEditor({ ...options, projectStore: projectStore || legacyStore })
  const setContext = view.setContext, destroy = view.destroy
  view.setContext = (...args) => { epoch++; return setContext(...args) }
  view.destroy = () => { epoch++; destroy() }
  return view
}
