import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { RUNTIME_FILES, bindRuntimeSources, freezeStudy } from '../src/benchmark/study.mjs'
import { canonical, sha256 } from '../src/benchmark/prompts.mjs'
import { projectFiles } from '../src/benchmark/export.mjs'
import { runStudy } from '../src/benchmark/runner.mjs'
import { auditCustomGrades } from '../src/benchmark/cli.mjs'
import { developmentStarter } from '../tools/test/fixtures/research-benchmark-development.mjs'

const cli = fileURLToPath(new URL('../src/benchmark/cli.mjs', import.meta.url))
const host = fileURLToPath(new URL('../src/benchmark/module-host.mjs', import.meta.url))
const sources = Object.fromEntries(await Promise.all(RUNTIME_FILES.map(async file =>
  [file, await readFile(new URL('../src/benchmark/' + file, import.meta.url), 'utf8')])))
// The benign grader only counts calls in its disposable study directory and
// returns the same authored arithmetic result retained in the fixture journal.
const grader = `import { appendFile } from 'node:fs/promises'
export async function grade(project, task, output) {
  await appendFile('grader-calls.jsonl', JSON.stringify({ host: process.argv[1] }) + '\\n')
  const passed = output === task.expected
  return { passed, score: passed ? 1 : 0, classification: passed ? 'correct' : 'incorrect' }
}
`
const authoredGrade = (project, task, output) => {
  const passed = output === task.expected
  return { passed, score: passed ? 1 : 0, classification: passed ? 'correct' : 'incorrect' }
}
async function fixture(t, foreign = false, grade = authoredGrade) {
  const root = await mkdtemp(resolve(tmpdir(), 'benchmark-inspection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runtime = { ...sources }
  if (foreign) runtime['module-host.mjs'] += '\n// Benign previous runtime fixture; no behavior change.\n'
  const spec = developmentStarter()
  spec.protocol.grading = { kind: 'module', file: 'grader.mjs' }
  spec.inputs.push({ path: 'grader.mjs', sha256: await sha256(grader) })
  const project = await freezeStudy(await bindRuntimeSources(spec, runtime))
  const files = await projectFiles(project, runtime, { 'grader.mjs': grader })
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, file)), { recursive: true })
    await writeFile(resolve(root, file), contents)
  }
  const { events } = await runStudy(project, { grade })
  await mkdir(resolve(root, 'results'), { recursive: true })
  await writeFile(resolve(root, 'results/attempts.jsonl'), events.map(canonical).join('\n') + '\n')
  // A test-owned launcher imports the trusted CLI and forbids all subprocess
  // creation during inspection, so even a host that never calls grade fails.
  await writeFile(resolve(root, 'inspect-without-children.mjs'), `
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
childProcess.spawn = () => { throw new Error('Inspection must not start a subprocess.') }
syncBuiltinESMExports()
const { main } = await import(${JSON.stringify(new URL('../src/benchmark/cli.mjs', import.meta.url).href)})
await main(process.argv.slice(2))
`)
  return { root, project, events }
}
function command(root, action) {
  const entry = ['status', 'analyze', 'reference'].includes(action) ? resolve(root, 'inspect-without-children.mjs') : cli
  return spawnSync(process.execPath, [entry, action, '--project', root], { cwd: root, encoding: 'utf8', timeout: 20000 })
}
async function calls(root) {
  try { return (await readFile(resolve(root, 'grader-calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

for (const foreign of [false, true]) test(`trusted inspection retains custom scores without execution (${foreign ? 'foreign' : 'matching'} runtime)`, async t => {
  const { root, project, events } = await fixture(t, foreign)
  const journal = await readFile(resolve(root, 'results/attempts.jsonl'), 'utf8')
  for (const action of ['status', 'analyze', 'reference']) {
    const result = command(root, action)
    assert.equal(result.status, 0, action + ': ' + result.stderr)
    assert.deepEqual(await calls(root), [], action + ' must not invoke the study grader or its module host')
    const receipt = JSON.parse(result.stdout)
    assert.equal(receipt.customGrading.verification, 'retained-not-reexecuted')
    assert.deepEqual(receipt.customGrading.grader, { file: 'grader.mjs', sha256: project.spec.inputs.find(input => input.path === 'grader.mjs').sha256 })
  }
  assert.equal(await readFile(resolve(root, 'results/attempts.jsonl'), 'utf8'), journal)
  assert.deepEqual(JSON.parse(await readFile(resolve(root, 'results/evidence.json'), 'utf8')).events, events)
  assert.match(await readFile(resolve(root, 'results/report.md'), 'utf8'), /not re-executed/i)
})

test('explicit regrade uses the installed host and retains a separate execution receipt', async t => {
  const { root, project, events } = await fixture(t)
  const journal = await readFile(resolve(root, 'results/attempts.jsonl'), 'utf8')
  const result = command(root, 'regrade')
  assert.equal(result.status, 0, result.stderr)
  const invocations = await calls(root)
  const completed = events.filter(event => event.type === 'finished' && event.status === 'completed').length
  assert.equal(invocations.length, completed)
  assert.ok(invocations.every(call => call.host === host), 'only the installed module host runs')
  const receipt = JSON.parse(await readFile(resolve(root, 'results/custom-grade-verification.json'), 'utf8'))
  assert.equal(receipt.projectSha256, project.sha256)
  assert.equal(receipt.journalSha256, await sha256(canonical(events)))
  assert.equal(receipt.evidenceStatus, 'reexecuted-agrees-with-retained')
  assert.equal(receipt.checked, completed)
  assert.equal(await readFile(resolve(root, 'results/attempts.jsonl'), 'utf8'), journal)
  assert.equal(command(root, 'status').status, 0)
  assert.equal((await calls(root)).length, completed, 'later inspection does not repeat explicit execution')
})

test('foreign runtime cannot regrade through the CLI or the existing explicit audit API', async t => {
  const { root, project, events } = await fixture(t, true)
  const result = command(root, 'regrade')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /runtime.*differs|differs.*runtime/i)
  await assert.rejects(auditCustomGrades(root, project, events), /runtime.*differs|differs.*runtime/i)
  assert.deepEqual(await calls(root), [])
})

test('retained scores remain inspectable while explicit regrade reports a benign disagreement', async t => {
  const { root } = await fixture(t, false, () => ({ passed: false, score: 0, classification: 'authored-control' }))
  const journal = await readFile(resolve(root, 'results/attempts.jsonl'), 'utf8')
  const inspected = command(root, 'status')
  assert.equal(inspected.status, 0, inspected.stderr)
  assert.equal(JSON.parse(inspected.stdout).groups[0].passed, 0)
  assert.deepEqual(await calls(root), [])
  const regraded = command(root, 'regrade')
  assert.notEqual(regraded.status, 0)
  assert.match(regraded.stderr, /recorded custom grade disagrees/)
  assert.equal((await calls(root)).length, 1)
  assert.equal(await readFile(resolve(root, 'results/attempts.jsonl'), 'utf8'), journal)
  await assert.rejects(readFile(resolve(root, 'results/custom-grade-verification.json')), { code: 'ENOENT' })
})
