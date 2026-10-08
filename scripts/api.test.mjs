import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const serverPath = path.join(root, 'server.js')

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API server exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.ok) return
    } catch {
      await delay(100)
    }
  }
  throw new Error('API server did not become ready')
}

test('records players, weights missed facts, and ranks correct answers', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'multiplication-api-'))
  const port = await freePort()
  const serverUrl = `http://127.0.0.1:${port}`
  const baseUrl = `${serverUrl}/api`
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, DATA_DIR: dataDirectory, PORT: String(port) },
    stdio: 'ignore',
  })

  try {
    await waitForServer(serverUrl, child)
    const firstId = randomUUID()
    const secondId = randomUUID()
    const register = (id, name) => fetch(`${baseUrl}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    })
    const firstResponse = await register(firstId, 'Practice One')
    assert.equal(firstResponse.status, 200)
    await register(secondId, 'Practice Two')

    const duplicateName = await register(randomUUID(), 'practice one')
    assert.equal(duplicateName.status, 409)

    async function submit(playerId, answer) {
      const response = await fetch(`${baseUrl}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, left: 12, right: 12, answer }),
      })
      assert.equal(response.status, 200)
      return response.json()
    }

    assert.equal((await submit(firstId, 1)).isCorrect, false)
    assert.equal((await submit(secondId, 144)).isCorrect, true)
    const player = await (await fetch(`${baseUrl}/players/${secondId}`)).json()
    assert.equal(player.answered, 1)
    assert.equal(player.correct, 1)
    assert.equal(player.streak, 1)

    const weights = await (await fetch(`${baseUrl}/weights?limit=12`)).json()
    const hardFact = weights.find((fact) => fact.left === 12 && fact.right === 12)
    assert.deepEqual({ attempts: hardFact.attempts, wrong: hardFact.wrong, weight: hardFact.weight }, {
      attempts: 2,
      wrong: 1,
      weight: 7,
    })

    const leaderboard = await (await fetch(`${baseUrl}/leaderboard`)).json()
    assert.equal(leaderboard[0].name, 'Practice Two')
    assert.equal(leaderboard[0].correct, 1)
    assert.equal('id' in leaderboard[0], false)
  } finally {
    child.kill()
    if (child.exitCode === null) await once(child, 'exit')
    await rm(dataDirectory, { recursive: true, force: true })
  }
})