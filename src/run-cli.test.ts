import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { resolveJavaScriptRuntime } from "./run-cli.ts"

test("resolveJavaScriptRuntime falls back when execPath is not a JS runtime", async () => {
	const dir = await mkdtemp(join(tmpdir(), "quota-non-runtime-"))
	const nonRuntime = join(dir, "host")
	await writeFile(nonRuntime, "#!/bin/sh\nexit 0\n")
	await chmod(nonRuntime, 0o755)

	try {
		assert.equal(await resolveJavaScriptRuntime(nonRuntime, [nonRuntime]), undefined)
		const runtime = await resolveJavaScriptRuntime(nonRuntime, [nonRuntime, process.execPath])
		assert.equal(runtime, process.execPath)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
})
