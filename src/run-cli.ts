import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const TIMEOUT_MS = 15_000
const MAX_BUFFER_BYTES = 4 * 1024 * 1024
const RUNTIME_PROBE = "opencode-quota-runtime"
let defaultRuntime: Promise<string | undefined> | undefined

/**
 * Resolves an executable that can run a JavaScript file. OpenCode's compiled
 * executable is not one, even though it is exposed as `process.execPath`.
 */
export async function resolveJavaScriptRuntime(
	execPath: string = process.execPath,
	candidates: readonly string[] = [execPath, "node", "bun"],
): Promise<string | undefined> {
	for (const candidate of new Set(candidates)) {
		try {
			const { stdout } = await execFileAsync(
				candidate,
				["--eval", `process.stdout.write(${JSON.stringify(RUNTIME_PROBE)})`],
				{ timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
			)
			if (stdout === RUNTIME_PROBE) return candidate
		} catch {
			// Try the next candidate. A non-JS host executable is expected here.
		}
	}
	return undefined
}

async function withRuntime(execPath: string): Promise<string> {
	const runtime = await (execPath === process.execPath
		? (defaultRuntime ??= resolveJavaScriptRuntime(execPath))
		: resolveJavaScriptRuntime(execPath))
	if (!runtime) throw new Error("could not find a JavaScript runtime to run opencode-quota")
	return runtime
}

/**
 * Runs `opencode-quota show` (no `--json`) purely for its side effect of
 * repopulating the on-disk cache. Its own exit code and output are not the
 * point; callers should let this fail silently and read the cache
 * afterwards regardless.
 */
export async function runQuotaShow(cliPath: string, execPath: string = process.execPath): Promise<void> {
	await execFileAsync(await withRuntime(execPath), [cliPath, "show"], { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES })
}

/**
 * Runs `opencode-quota show --json` and returns its raw stdout. Throws on
 * any failure (missing binary, non-zero exit, timeout); the caller is
 * expected to turn that into a fail-soft one-line result rather than letting
 * it propagate.
 */
export async function runQuotaShowJson(cliPath: string, execPath: string = process.execPath): Promise<string> {
	const { stdout } = await execFileAsync(await withRuntime(execPath), [cliPath, "show", "--json"], {
		timeout: TIMEOUT_MS,
		maxBuffer: MAX_BUFFER_BYTES,
	})
	return stdout
}
