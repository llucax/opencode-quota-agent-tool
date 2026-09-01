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
			"quota, cached 4m ago",
			"anthropic       5h 18% (resets in 50m), weekly 92% (6d)",
			"github-copilot  premium 100% (29d)",
			"openai          5h 100% (4h30m), weekly 84% (5d)",
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
	assert.equal(output.split("\n")[1], "openrouter  401 unauthorized")
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
	assert.equal(output.split("\n")[1], "anthropic  5h 50% (1h), weekly window unavailable")
})

test("a stale cache says so plainly in the header", () => {
	const fresh = formatQuotaOutput(baseExport({ cacheAgeSeconds: 60 }), { nowSeconds: NOW })
	const stale = formatQuotaOutput(baseExport({ cacheAgeSeconds: 45 * 60 }), { nowSeconds: NOW })
	assert.equal(fresh.split("\n")[0], "quota, cached 1m ago")
	assert.equal(stale.split("\n")[0], "quota, cached 45m ago (stale, over 30m old)")
})

test("percentDisplayMode: used inverts the printed percentage", () => {
	const data = baseExport({
		providers: {
			anthropic: {
				status: "ok",
				fetchedAt: NOW,
				entries: [{ name: "Claude 5h", window: "5h", resetAt: NOW + 3600, renderType: "percent", percentRemaining: 18 }],
			},
		},
	})
	const remaining = formatQuotaOutput(data, { nowSeconds: NOW, percentDisplayMode: "remaining" })
	const used = formatQuotaOutput(data, { nowSeconds: NOW, percentDisplayMode: "used" })
	assert.ok(remaining.includes("18%"))
	assert.ok(used.includes("82%"))
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
	assert.equal(output.split("\n")[1], "cursor  monthly $12.50")
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
	assert.equal(output.split("\n")[1], "anthropic  5h 50% (resets any moment)")
})

test("no provider data yields an honest empty-state line instead of a bare header", () => {
	const output = formatQuotaOutput(baseExport(), { nowSeconds: NOW })
	assert.equal(output, "quota, cached 4m ago\nNo provider data available.")
})
