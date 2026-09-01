import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const TIMEOUT_MS = 15_000
const MAX_BUFFER_BYTES = 4 * 1024 * 1024

/**
 * Runs `opencode-quota show` (no `--json`) purely for its side effect of
 * repopulating the on-disk cache. Its own exit code and output are not the
 * point; callers should let this fail silently and read the cache
 * afterwards regardless.
 */
export async function runQuotaShow(cliPath: string, execPath: string = process.execPath): Promise<void> {
	await execFileAsync(execPath, [cliPath, "show"], { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES })
}

/**
 * Runs `opencode-quota show --json` and returns its raw stdout. Throws on
 * any failure (missing binary, non-zero exit, timeout); the caller is
 * expected to turn that into a fail-soft one-line result rather than letting
 * it propagate.
 */
export async function runQuotaShowJson(cliPath: string, execPath: string = process.execPath): Promise<string> {
	const { stdout } = await execFileAsync(execPath, [cliPath, "show", "--json"], {
		timeout: TIMEOUT_MS,
		maxBuffer: MAX_BUFFER_BYTES,
	})
	return stdout
}
