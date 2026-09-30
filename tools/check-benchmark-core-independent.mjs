#!/usr/bin/env node
// The domain boundary is a zero-dependency gate. Historical inventories and
// citation records retain names as data; executable core code uses descriptors.
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../src/benchmark/', import.meta.url)
const VERTICAL = /^(?:(?:lean|trading)[-.]|lean\.mjs$|execution[-_]lean|execution\.mjs$)/
const SEAM = new Set(['plugins.mjs', 'runtime-inventory.mjs'])
export const KNOWN_REMAINING = Object.freeze({})
export function layerOf(file) {
  return SEAM.has(file) ? 'seam' : VERTICAL.test(file) ? 'vertical' : 'core'
}
const uncomment = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const statics = /(?:^|\n)\s*(?:import\s+(?:[^;'"`]*?\s+from\s+)?|export\s+[^;'"`]*?\s+from\s+)['"]\.\/([^'"]+)['"]/g
const dynamics = /(?:import|require)\s*\(\s*['"]\.\/([^'"]+)['"]/g
const domainNames = /\b(?:leanProfile|leanImage)\b|['"](?:lean-bench|lean-python|operational-v1|derive-lean|synchronous-v1)['"]/g
function executableText(file, source) {
  return uncomment(source).split('\n').filter(line => {
    if (file === 'study-schema.mjs' && /^export const (?:LEGACY|V2|V3)_RUNTIME_FILES\b/.test(line)) return false
    if (file === 'study.mjs' && /changes:\s*\{\s*pinnedFiles:/.test(line)) return false
    return true
  }).join('\n')
}
export async function inventory() {
  const files = (await readdir(fileURLToPath(root))).filter(name => name.endsWith('.mjs')).sort()
  const known = new Set(files)
  return Promise.all(files.map(async file => {
    const source = await readFile(new URL(file, root), 'utf8'), code = executableText(file, source)
    const imports = new Set([...code.matchAll(statics), ...code.matchAll(dynamics)].map(match => match[1]))
    return { file, layer: layerOf(file),
      importsVertical: [...imports].filter(name => known.has(name) && layerOf(name) === 'vertical').sort(),
      mentionsVertical: files.filter(name => layerOf(name) === 'vertical' && code.includes(name)),
      domainNames: [...new Set([...code.matchAll(domainNames)].map(match => match[0]))] }
  }))
}
const rows = await inventory(), core = rows.filter(row => row.layer === 'core')
const failures = core.filter(row => row.importsVertical.length || row.mentionsVertical.length || row.domainNames.length)
for (const row of failures) console.error(`${row.file}: domain dependency ${[...new Set([...row.importsVertical, ...row.mentionsVertical, ...row.domainNames])].join(', ')}`)
console.log(`Core modules: ${core.length}; domain modules: ${rows.filter(row => row.layer === 'vertical').length}; configuration seams: ${rows.filter(row => row.layer === 'seam').length}.`)
if (failures.length) { console.error(`FAIL: ${failures.length} core module(s) depend on domain implementations or identifiers.`); process.exitCode = 1 }
else console.log('OK: zero core-to-domain imports, module references or active domain identifiers.')
