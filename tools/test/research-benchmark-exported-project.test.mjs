// Opening an exported project is not the same act as freezing one. The page's
// own compiler may differ from the runtime that produced the archive, so these
// tests separate two questions the page must never conflate: is the archive
// intact and internally consistent (always answerable, no pinned runtime
// needed), and can this runtime rebuild the project byte for byte (answerable
// only when the runtimes agree). The second is reported, not thrown, so the
// caller can admit a project it cannot rebuild without claiming it verified it.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { canonical, sha256 } from '../../src/benchmark/prompts.mjs'
import { CORE_RUNTIME_FILES, RUNTIME_FILES, bindRuntimeSources, freezeStudy, runtimeFilesFor } from '../../src/benchmark/study.mjs'
import { genericStarter, newExperimentDraft } from '../../src/benchmark/starters.mjs'
import { projectFiles, zipFiles } from '../../src/benchmark/export.mjs'
import { unzipFiles } from '../../src/benchmark/archive.mjs'
import { readExportedProject } from '../../src/benchmark/exported-project.mjs'

const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async file =>
  [file, await readFile(new URL('../../src/benchmark/' + file, import.meta.url), 'utf8')])))

async function exportedFiles() {
  const spec = await bindRuntimeSources(newExperimentDraft(genericStarter(), { initializePopulation: true }), sources)
  return { files: await projectFiles(await freezeStudy(spec), sources), spec }
}

// Re-seal a mutated project so the archive stays internally consistent. This is
// what an archive frozen by a different runtime looks like: every digest agrees
// with itself, and only a rebuild here can tell that the compiler has moved.
async function reseal(files, mutate) {
  const { sha256: _previous, ...body } = JSON.parse(files['project.json'])
  mutate(body)
  const project = { ...body, sha256: await sha256(canonical(body)) }
  const next = { ...files, 'project.json': JSON.stringify(project, null, 2) + '\n' }
  const manifest = JSON.parse(next['manifest.json'])
  const digests = {}
  for (const name of Object.keys(manifest.files)) digests[name] = await sha256(next[name])
  next['manifest.json'] = canonical({ format: 'research-benchmark-files', version: 1, projectSha256: project.sha256, files: digests }) + '\n'
  return next
}

test('a project exported by this runtime opens, verifies and rebuilds', async () => {
  const { files } = await exportedFiles()
  const opened = await readExportedProject(unzipFiles(zipFiles(files)), { sources })
  assert.equal(opened.project.sha256, JSON.parse(files['project.json']).sha256)
  assert.equal(opened.integrity.ok, true)
  assert.equal(opened.integrity.checked, Object.keys(JSON.parse(files['manifest.json']).files).length)
  assert.equal(opened.runtime.compared, true)
  assert.equal(opened.runtime.matches, true)
  assert.deepEqual(opened.runtime.differing, [])
  assert.equal(opened.rebuild.verified, true)
  assert.equal(opened.rebuild.reason, null)
})

test('the runtime comparison is reported as not done when no sources are supplied', async () => {
  const { files } = await exportedFiles()
  const opened = await readExportedProject(unzipFiles(zipFiles(files)))
  assert.equal(opened.runtime.compared, false)
  assert.equal(opened.integrity.ok, true)
})

test('a changed file is refused and named', async () => {
  const { files } = await exportedFiles()
  const tampered = { ...files, 'README.md': files['README.md'] + 'an added line\n' }
  await assert.rejects(() => readExportedProject(tampered, { sources }), /README\.md/)
})

test('an archive without a project is refused', async () => {
  const { files } = await exportedFiles()
  const { 'project.json': _removed, ...rest } = files
  await assert.rejects(() => readExportedProject(rest, { sources }), /project\.json/)
})

test('an archive with no manifest is refused', async () => {
  const { files } = await exportedFiles()
  const { 'manifest.json': _removed, ...rest } = files
  await assert.rejects(() => readExportedProject(rest, { sources }), /manifest|exported project/i)
})

test('a manifest naming a different project is refused', async () => {
  const { files } = await exportedFiles()
  const manifest = JSON.parse(files['manifest.json'])
  const wrong = { ...files, 'manifest.json': canonical({ ...manifest, projectSha256: 'f'.repeat(64) }) + '\n' }
  await assert.rejects(() => readExportedProject(wrong, { sources }), /different project|belongs/i)
})

test('a missing pinned runtime file is refused', async () => {
  const { files } = await exportedFiles()
  const manifest = JSON.parse(files['manifest.json'])
  const without = Object.fromEntries(Object.entries(manifest.files).filter(([name]) => name !== 'report.mjs'))
  const stripped = { ...files, 'manifest.json': canonical({ ...manifest, files: without }) + '\n' }
  delete stripped['report.mjs']
  await assert.rejects(() => readExportedProject(stripped, { sources }), /report\.mjs/)
})

test('an intact archive this runtime cannot rebuild opens read-only, with the cause named', async () => {
  const { files } = await exportedFiles()
  const foreign = await reseal(files, project => { project.readiness = { ...project.readiness, blockers: [] } })
  const opened = await readExportedProject(foreign, { sources })
  assert.equal(opened.integrity.ok, true, 'the archive is intact; only the compiler has moved')
  assert.equal(opened.rebuild.verified, false)
  assert.match(opened.rebuild.reason, /readiness/)
  assert.equal(opened.project.sha256, JSON.parse(foreign['project.json']).sha256)
})

test('a rebuild failure names the fields that differ, not just that something did', async () => {
  const { files } = await exportedFiles()
  const foreign = await reseal(files, project => { project.readiness = { ...project.readiness, blockers: [] } })
  const opened = await readExportedProject(foreign, { sources })
  assert.ok(Array.isArray(opened.rebuild.differing))
  assert.ok(opened.rebuild.differing.some(path => path.includes('readiness')), opened.rebuild.differing.join(','))
})

test('archive inspection uses the archived schema-4 plugin inventory across differently configured builds', async () => {
  const { files } = await exportedFiles(), changed = { ...files }, manifest = JSON.parse(files['manifest.json'])
  const installedPluginFiles = RUNTIME_FILES.filter(file => !CORE_RUNTIME_FILES.includes(file))
  for (const file of installedPluginFiles) { delete changed[file]; delete manifest.files[file] }
  const extra = 'different-plugin.mjs', text = '// Retained source from a differently configured build.\nexport const endpoint = "recorded-control";\n'
  changed[extra] = text; manifest.files[extra] = await sha256(text)
  changed['manifest.json'] = canonical(manifest) + '\n'
  const foreign = await reseal(changed, project => {
    assert.equal(project.spec.schemaVersion, 4)
    for (const file of installedPluginFiles) delete project.spec.runtimeSources[file]
    project.spec.runtimeSources[extra] = manifest.files[extra]
    project.runtimeFiles = [...CORE_RUNTIME_FILES, extra]
  })
  const opened = await readExportedProject(foreign, { sources })
  assert.equal(opened.integrity.ok, true, 'intact foreign packages remain inspectable without their configured plugin installed')
  assert.deepEqual(runtimeFilesFor(opened.project), [...CORE_RUNTIME_FILES, extra])
  assert.deepEqual(opened.runtime.differing, [extra], 'installed plugin files cannot become phantom archive requirements')
  const without = { ...foreign }, strippedManifest = JSON.parse(without['manifest.json'])
  delete without[extra]; delete strippedManifest.files[extra]
  without['manifest.json'] = canonical(strippedManifest) + '\n'
  await assert.rejects(() => readExportedProject(without, { sources }), /different-plugin\.mjs/)
})
