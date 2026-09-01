import assert from "node:assert/strict"
import test from "node:test"
import { parseQuotaExport } from "./quota-export.ts"

test("parses a real-shaped export document", () => {
	const raw = {
		version: 2,
		exportedAt: 1788263334,
		fromCache: true,
		cacheAgeSeconds: 220,
		providers: {
			anthropic: {
				status: "ok",
				fetchedAt: 1788263115,
				entries: [
					{
						name: "Claude 5h",
						resultType: "quota",
						acquisitionMethod: "remote_api",
						ownership: "maintained",
						authority: "provider_reported",
						window: "5h",
						resetAt: 1788279600,
						renderType: "percent",
						percentRemaining: 94,
					},
				],
			},
			openrouter: { status: "unavailable" },
		},
	}
	const parsed = parseQuotaExport(raw)
	assert.equal(parsed.cacheAgeSeconds, 220)
	assert.equal(parsed.providers.anthropic?.status, "ok")
	assert.equal(parsed.providers.openrouter?.status, "unavailable")
	if (parsed.providers.anthropic?.status === "ok") {
		assert.equal(parsed.providers.anthropic.entries[0]?.percentRemaining, 94)
	}
})

test("throws only when the document is not recognizable as an export at all", () => {
	assert.throws(() => parseQuotaExport(null))
	assert.throws(() => parseQuotaExport({}))
	assert.throws(() => parseQuotaExport({ providers: {} }))
	assert.doesNotThrow(() => parseQuotaExport({ exportedAt: 1, cacheAgeSeconds: 1, providers: {} }))
})

test("a malformed individual provider degrades to unavailable instead of throwing", () => {
	const parsed = parseQuotaExport({
		exportedAt: 1,
		cacheAgeSeconds: 1,
		providers: {
			broken: { status: "ok", fetchedAt: 1 /* entries missing */ },
			alsoBroken: "not even an object",
		},
	})
	assert.equal(parsed.providers.broken?.status, "unavailable")
	assert.equal(parsed.providers.alsoBroken?.status, "unavailable")
})

test("an entry missing its renderType-specific field is dropped, not fabricated", () => {
	const parsed = parseQuotaExport({
		exportedAt: 1,
		cacheAgeSeconds: 1,
		providers: {
			anthropic: {
				status: "ok",
				fetchedAt: 1,
				entries: [
					{ name: "ok entry", renderType: "percent", percentRemaining: 50 },
					{ name: "bad entry", renderType: "percent" /* no percentRemaining */ },
				],
			},
		},
	})
	if (parsed.providers.anthropic?.status === "ok") {
		assert.equal(parsed.providers.anthropic.entries.length, 1)
		assert.equal(parsed.providers.anthropic.entries[0]?.name, "ok entry")
	} else {
		assert.fail("expected status ok")
	}
})
