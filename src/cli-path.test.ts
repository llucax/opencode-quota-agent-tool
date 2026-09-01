import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { compareVersions, parsePluginSpec, resolveQuotaCliPath } from "./cli-path.ts"

test("parsePluginSpec splits a scoped name from its version", () => {
	assert.deepEqual(parsePluginSpec("@slkiser/opencode-quota@4.8.2"), {
		name: "@slkiser/opencode-quota",
		version: "4.8.2",
	})
})

test("parsePluginSpec splits an unscoped name from its version", () => {
	assert.deepEqual(parsePluginSpec("opencode-direnv@1.1.1"), { name: "opencode-direnv", version: "1.1.1" })
})

test("parsePluginSpec leaves an unversioned spec with no version", () => {
	assert.deepEqual(parsePluginSpec("@slkiser/opencode-quota"), { name: "@slkiser/opencode-quota" })
	assert.deepEqual(parsePluginSpec("opencode-direnv"), { name: "opencode-direnv" })
})

test("compareVersions orders numerically, not lexically", () => {
	assert.ok(compareVersions("4.8.2", "4.0.1") > 0, "4.8.2 must outrank 4.0.1")
	assert.ok(compareVersions("4.10.0", "4.9.0") > 0, "10 must outrank 9 numerically")
	assert.equal(compareVersions("1.2.3", "1.2.3"), 0)
})

test("compareVersions ranks a release above a same-numbered prerelease", () => {
	assert.ok(compareVersions("4.8.2", "4.8.2-beta.1") > 0)
	assert.ok(compareVersions("4.8.2-beta.1", "4.8.2") < 0)
})

/** Builds a fake `packagesDir` fixture with an empty file at each version's binary path. */
async function makeFixture(versions: string[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "quota-cli-path-"))
	for (const version of versions) {
		const binDir = join(dir, `@slkiser/opencode-quota@${version}`, "node_modules/@slkiser/opencode-quota/dist/bin")
		await mkdir(binDir, { recursive: true })
		await writeFile(join(binDir, "opencode-quota.js"), "// fixture\n")
	}
	return dir
}

test("resolveQuotaCliPath picks the highest installed version when config pins none", async () => {
	// This is the real failure mode the brief calls out: both 4.0.1 and 4.8.2
	// on disk, nothing in config, must not land on the older one.
	const packagesDir = await makeFixture(["4.0.1", "4.8.2"])
	try {
		const resolved = await resolveQuotaCliPath({}, { packagesDir })
		assert.ok(resolved?.includes("opencode-quota@4.8.2/"), `expected 4.8.2, got ${resolved}`)
	} finally {
		await rm(packagesDir, { recursive: true, force: true })
	}
})

test("resolveQuotaCliPath honors the version pinned in the config plugin array", async () => {
	const packagesDir = await makeFixture(["4.0.1", "4.8.2"])
	try {
		const resolved = await resolveQuotaCliPath({ plugin: ["@slkiser/opencode-quota@4.0.1"] }, { packagesDir })
		assert.ok(resolved?.includes("opencode-quota@4.0.1/"), `expected the pinned 4.0.1, got ${resolved}`)
	} finally {
		await rm(packagesDir, { recursive: true, force: true })
	}
})

test("resolveQuotaCliPath accepts the [name, options] plugin array form", async () => {
	const packagesDir = await makeFixture(["4.0.1", "4.8.2"])
	try {
		const resolved = await resolveQuotaCliPath(
			{ plugin: [["@slkiser/opencode-quota@4.0.1", { some: "option" }]] },
			{ packagesDir },
		)
		assert.ok(resolved?.includes("opencode-quota@4.0.1/"), `expected the pinned 4.0.1, got ${resolved}`)
	} finally {
		await rm(packagesDir, { recursive: true, force: true })
	}
})

test("resolveQuotaCliPath falls back to the highest version when the pinned one is not on disk", async () => {
	const packagesDir = await makeFixture(["4.8.2"])
	try {
		const resolved = await resolveQuotaCliPath({ plugin: ["@slkiser/opencode-quota@9.9.9"] }, { packagesDir })
		assert.ok(resolved?.includes("opencode-quota@4.8.2/"), `expected fallback to 4.8.2, got ${resolved}`)
	} finally {
		await rm(packagesDir, { recursive: true, force: true })
	}
})

test("resolveQuotaCliPath returns undefined, not a throw, when nothing is installed", async () => {
	const packagesDir = await mkdtemp(join(tmpdir(), "quota-cli-path-empty-"))
	try {
		const resolved = await resolveQuotaCliPath({}, { packagesDir })
		assert.equal(resolved, undefined)
	} finally {
		await rm(packagesDir, { recursive: true, force: true })
	}
})

test("resolveQuotaCliPath ignores unrelated plugin entries", async () => {
	const packagesDir = await makeFixture(["4.8.2"])
	try {
		const resolved = await resolveQuotaCliPath(
			{ plugin: ["opencode-claude-auth@2.1.6", "opencode-direnv@1.1.1"] },
			{ packagesDir },
		)
		assert.ok(resolved?.includes("opencode-quota@4.8.2/"), `expected fallback to 4.8.2, got ${resolved}`)
	} finally {
		await rm(packagesDir, { recursive: true, force: true })
	}
})
