import assert from "node:assert/strict"
import test from "node:test"
import { formatQuotaOutput } from "./format.ts"
import type { QuotaExport } from "./quota-export.ts"

/** A fixed "now" so reset deltas are deterministic; resetAt values below are chosen relative to it. */
const NOW = 1_800_000_000

function baseExport(overrides: Partial<QuotaExport> = {}): QuotaExport {
	return { exportedAt: NOW, cacheAgeSeconds: 240, providers: {}, ...overrides }
}

test("matches the signed-off shape: two-entry, single-entry, and window-derived label", () => {
	const data = baseExport({
		providers: {
			anthropic: {
				status: "ok",
				fetchedAt: NOW,
				entries: [
					{ name: "Claude 5h", window: "5h", resetAt: NOW + 50 * 60, renderType: "percent", percentRemaining: 18 },
					{
						name: "Claude Weekly",
						window: "Weekly",
						resetAt: NOW + 6 * 86400,
						renderType: "percent",
						percentRemaining: 92,
					},
				],
			},
			copilot: {
				status: "ok",
				fetchedAt: NOW,
				entries: [
					{
						name: "Copilot Premium Interactions",
						resetAt: NOW + 29 * 86400,
						renderType: "percent",
						percentRemaining: 100,
					},
				],
			},
			openai: {
				status: "ok",
				fetchedAt: NOW,
				entries: [
					{
						name: "OpenAI (Plus) 5h",
						window: "5h",
						resetAt: NOW + 4 * 3600 + 30 * 60,
						renderType: "percent",
						percentRemaining: 100,
					},
					{
						name: "OpenAI (Plus) Weekly",
						window: "Weekly",
						resetAt: NOW + 5 * 86400,
						renderType: "percent",
						percentRemaining: 84,
					},
				],
			},
		},
	})

	const output = formatQuotaOutput(data, { nowSeconds: NOW })
	assert.equal(
		output,
		[
			"quota, cached 4m ago; spare = remaining% - time-left%, provider = lowest window",
			"openai          spare +10   5h 100% (4h30m) +10, weekly 84% (5d) +13",
			"anthropic       spare +1    5h 18% (resets in 50m) +1, weekly 92% (6d) +6",
			"github-copilot              premium 100% (29d)",
		].join("\n"),
	)
})

test("unavailable providers are omitted entirely", () => {
	const data = baseExport({
		providers: {
			anthropic: {
				status: "ok",
				fetchedAt: NOW,
				entries: [{ name: "Claude 5h", window: "5h", resetAt: NOW + 3600, renderType: "percent", percentRemaining: 50 }],
			},
			cursor: { status: "unavailable" },
		},
	})
	const output = formatQuotaOutput(data, { nowSeconds: NOW })
	assert.ok(!output.includes("cursor"), `unavailable provider leaked into output: ${output}`)
})

test("an error provider renders as a single line carrying the message", () => {
	const data = baseExport({
		providers: {
			openrouter: { status: "error", fetchedAt: NOW, error: "401 unauthorized" },
		},
	})
	const output = formatQuotaOutput(data, { nowSeconds: NOW })
	assert.equal(output.split("\n")[1], "openrouter              401 unauthorized")
})

test("a partial provider renders its entries plus the error", () => {
	const data = baseExport({
		providers: {
			anthropic: {
				status: "partial",
				fetchedAt: NOW,
				entries: [{ name: "Claude 5h", window: "5h", resetAt: NOW + 3600, renderType: "percent", percentRemaining: 50 }],
				errors: [{ label: "weekly", message: "weekly window unavailable" }],
			},
		},
	})
	const output = formatQuotaOutput(data, { nowSeconds: NOW })
	assert.equal(output.split("\n")[1], "anthropic  spare +30   5h 50% (1h) +30, weekly window unavailable")
})

test("a stale cache says so plainly in the header, at the default threshold", () => {
	const fresh = formatQuotaOutput(baseExport({ cacheAgeSeconds: 60 }), { nowSeconds: NOW })
	const stale = formatQuotaOutput(baseExport({ cacheAgeSeconds: 45 * 60 }), { nowSeconds: NOW })
	assert.equal(fresh.split("\n")[0], "quota, cached 1m ago; spare = remaining% - time-left%, provider = lowest window")
	assert.equal(
		stale.split("\n")[0],
		"quota, cached 45m ago (stale, over 30m old); spare = remaining% - time-left%, provider = lowest window",
	)
})

test("a stale cache reports the actual configured threshold, not a hardcoded one", () => {
	// A regression test for a real bug: the header used to always say "over 30m
	// old" regardless of staleThresholdSeconds, so a 5-minute threshold with a
	// 10-minute-old cache printed a false "over 30m old".
	const output = formatQuotaOutput(baseExport({ cacheAgeSeconds: 10 * 60 }), {
		nowSeconds: NOW,
		staleThresholdSeconds: 5 * 60,
	})
	assert.equal(
		output.split("\n")[0],
		"quota, cached 10m ago (stale, over 5m old); spare = remaining% - time-left%, provider = lowest window",
	)
})

test("a value-render entry prints its raw value instead of a percentage", () => {
	const data = baseExport({
		providers: {
			cursor: {
				status: "ok",
				fetchedAt: NOW,
				entries: [{ name: "Cursor Spend", window: "Monthly", renderType: "value", value: "$12.50" }],
			},
		},
	})
	const output = formatQuotaOutput(data, { nowSeconds: NOW })
	assert.equal(output.split("\n")[1], "cursor              monthly $12.50")
})

test("an entry past its own reset time says so instead of printing a negative duration", () => {
	const data = baseExport({
		providers: {
			anthropic: {
				status: "ok",
				fetchedAt: NOW,
				entries: [{ name: "Claude 5h", window: "5h", resetAt: NOW - 60, renderType: "percent", percentRemaining: 50 }],
			},
		},
	})
	const output = formatQuotaOutput(data, { nowSeconds: NOW })
	assert.equal(output.split("\n")[1], "anthropic  spare +50   5h 50% (resets any moment) +50")
})

test("a zero-percent entry past its reset is fully refilled rather than blocked", () => {
	const data = baseExport({
		providers: {
			anthropic: {
				status: "ok",
				fetchedAt: NOW,
				entries: [{ name: "Claude 5h", window: "5h", resetAt: NOW - 60, renderType: "percent", percentRemaining: 0 }],
			},
		},
	})
	assert.equal(formatQuotaOutput(data, { nowSeconds: NOW }).split("\n")[1], "anthropic  spare +0    5h 0% (resets any moment) +0")
})

test("no provider data yields an honest empty-state line instead of a bare header", () => {
	const output = formatQuotaOutput(baseExport(), { nowSeconds: NOW })
	assert.equal(
		output,
		"quota, cached 4m ago; spare = remaining% - time-left%, provider = lowest window\nNo provider data available.",
	)
})

test("a provider with status ok and zero entries is omitted, not printed as a dangling blank line", () => {
	// A regression test for a real bug: buildQuotaExport classifies zero
	// entries and zero errors as "ok", not "error", so this is a real shape
	// upstream can produce. Printing it as a padded ID with nothing after it
	// reads to an agent as "no quota left" rather than "no data".
	const data = baseExport({
		providers: {
			anthropic: { status: "ok", fetchedAt: NOW, entries: [] },
			openai: {
				status: "ok",
				fetchedAt: NOW,
				entries: [{ name: "OpenAI 5h", window: "5h", resetAt: NOW + 3600, renderType: "percent", percentRemaining: 50 }],
			},
		},
	})
	const output = formatQuotaOutput(data, { nowSeconds: NOW })
	assert.equal(
		output,
		"quota, cached 4m ago; spare = remaining% - time-left%, provider = lowest window\nopenai  spare +30   5h 50% (1h) +30",
	)
	assert.ok(!output.includes("anthropic"), `empty-entries provider leaked into output: ${output}`)
})

test("a partial provider with zero entries and zero errors is also omitted", () => {
	const data = baseExport({
		providers: {
			anthropic: { status: "partial", fetchedAt: NOW, entries: [], errors: [] },
		},
	})
	const output = formatQuotaOutput(data, { nowSeconds: NOW })
	assert.equal(
		output,
		"quota, cached 4m ago; spare = remaining% - time-left%, provider = lowest window\nNo provider data available.",
	)
})

test("marks a zero-percent window blocked and sorts providers by their lowest spare", () => {
	const data = baseExport({
		providers: {
			openai: {
				status: "ok",
				fetchedAt: NOW,
				entries: [
					{ name: "OpenAI 5h", window: "5h", resetAt: NOW + 90 * 60, renderType: "percent", percentRemaining: 0 },
				],
			},
			anthropic: {
				status: "ok",
				fetchedAt: NOW,
				entries: [{ name: "Claude 5h", window: "5h", resetAt: NOW + 3 * 3600, renderType: "percent", percentRemaining: 80 }],
			},
		},
	})

	assert.deepEqual(formatQuotaOutput(data, { nowSeconds: NOW }).split("\n").slice(1), [
		"anthropic  spare +20   5h 80% (3h) +20",
		"openai     spare -30   5h 0% (1h30m) -30 BLOCKED",
	])
})
