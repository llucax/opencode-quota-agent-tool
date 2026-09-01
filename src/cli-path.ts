import { access, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/** The upstream package this plugin shells out to. */
export const QUOTA_PACKAGE_NAME = "@slkiser/opencode-quota"

export type PluginArrayEntry = string | [string, Record<string, unknown>]

/** The slice of the opencode config this module reads: just the plugin array. */
export interface ConfigLike {
	plugin?: PluginArrayEntry[]
}

export interface ResolveQuotaCliPathOptions {
	/** Root of opencode's plugin package cache. Defaults to `$XDG_CACHE_HOME/opencode/packages`. */
	packagesDir?: string
	/** Overrides the package name, for tests. */
	packageName?: string
}

/**
 * Splits a plugin array entry like `"@slkiser/opencode-quota@4.8.2"` or
 * `"opencode-direnv@1.1.1"` into name and version. The scope's own leading
 * `@` is not a version separator, so scoped names look past it for the real
 * one.
 */
export function parsePluginSpec(spec: string): { name: string; version?: string } {
	const atIndex = spec.startsWith("@") ? spec.indexOf("@", 1) : spec.indexOf("@")
	if (atIndex === -1) return { name: spec }
	return { name: spec.slice(0, atIndex), version: spec.slice(atIndex + 1) }
}

function pluginEntrySpec(entry: PluginArrayEntry): string {
	return Array.isArray(entry) ? entry[0] : entry
}

/**
 * Compares two dotted version strings, positive when `a` is newer. Numeric
 * segments compare numerically; a release (no `-prerelease` suffix) always
 * outranks a prerelease of the same numeric version. Good enough for the
 * plain `x.y.z` versions this package actually ships; not a full semver
 * implementation.
 */
export function compareVersions(a: string, b: string): number {
	const [aMain, aPre] = splitPrerelease(a)
	const [bMain, bPre] = splitPrerelease(b)
	const aParts = aMain.split(".").map(toNumber)
	const bParts = bMain.split(".").map(toNumber)
	const len = Math.max(aParts.length, bParts.length)
	for (let i = 0; i < len; i++) {
		const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0)
		if (diff !== 0) return diff
	}
	if (aPre === undefined && bPre === undefined) return 0
	if (aPre === undefined) return 1
	if (bPre === undefined) return -1
	return aPre.localeCompare(bPre)
}

function splitPrerelease(version: string): [string, string | undefined] {
	const dash = version.indexOf("-")
	return dash === -1 ? [version, undefined] : [version.slice(0, dash), version.slice(dash + 1)]
}

function toNumber(part: string): number {
	const parsed = Number.parseInt(part, 10)
	return Number.isFinite(parsed) ? parsed : 0
}

function defaultPackagesDir(): string {
	const cacheBase = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache")
	return join(cacheBase, "opencode", "packages")
}

/**
 * Finds the highest version of `packageName` installed under the packages
 * cache, by directory name rather than by reading any manifest. Returns
 * undefined if the scope directory is missing or holds no matching entries.
 */
async function highestInstalledVersion(packagesDir: string, packageName: string): Promise<string | undefined> {
	const slash = packageName.indexOf("/")
	const scope = slash === -1 ? undefined : packageName.slice(0, slash)
	const name = slash === -1 ? packageName : packageName.slice(slash + 1)
	const scanDir = scope ? join(packagesDir, scope) : packagesDir

	let entries: string[]
	try {
		entries = await readdir(scanDir)
	} catch {
		return undefined
	}

	const prefix = `${name}@`
	const versions = entries.filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length))
	if (!versions.length) return undefined
	return versions.reduce((best, candidate) => (compareVersions(candidate, best) > 0 ? candidate : best))
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}

function binaryPathFor(packagesDir: string, packageName: string, version: string): string {
	return join(packagesDir, `${packageName}@${version}`, "node_modules", packageName, "dist", "bin", "opencode-quota.js")
}

/**
 * Resolves the on-disk path to the installed `opencode-quota` CLI entry
 * point. Prefers the version pinned in the opencode config's `plugin` array;
 * falls back to the highest version present under the packages cache when
 * the config carries no version, does not list the package, or the pinned
 * version turns out not to be on disk. Returns undefined, never throws, when
 * nothing resolvable is found; the packages directory currently holds
 * multiple versions side by side, so silently guessing wrong here is the
 * failure this function exists to avoid.
 */
export async function resolveQuotaCliPath(
	config: ConfigLike,
	options: ResolveQuotaCliPathOptions = {},
): Promise<string | undefined> {
	const packageName = options.packageName ?? QUOTA_PACKAGE_NAME
	const packagesDir = options.packagesDir ?? defaultPackagesDir()

	const configuredVersion = (config.plugin ?? [])
		.map(pluginEntrySpec)
		.map(parsePluginSpec)
		.find((parsed) => parsed.name === packageName)?.version

	const highestVersion = await highestInstalledVersion(packagesDir, packageName)

	const candidateVersions = [configuredVersion, highestVersion].filter(
		(version, index, all): version is string => version !== undefined && all.indexOf(version) === index,
	)

	for (const version of candidateVersions) {
		const candidate = binaryPathFor(packagesDir, packageName, version)
		if (await fileExists(candidate)) return candidate
	}
	return undefined
}
