import { it } from "vitest";
import assert from "node:assert/strict";
import Tool, { matches, normaliseRows, validateCouplerUrl } from "../read-coupler-export.tool.js";

it("reads, filters and pages a Coupler export", async () => {

  assert.throws(() => validateCouplerUrl("https://evil.com/export/x"));
  assert.throws(() => validateCouplerUrl("http://app.coupler.io/export/x"));
  assert.throws(() => validateCouplerUrl("https://app.coupler.io/api/x"));
  validateCouplerUrl("https://app.coupler.io/export/w/abc.json?access_token=t");
  assert.equal(normaliseRows({ data: [{ a: 1 }] }).length, 1);
  assert.deepEqual(normaliseRows({ columns: ["a", "b"], rows: [[1, 2]] }), [{ a: 1, b: 2 }]);
  assert.throws(() => normaliseRows({ x: 1 }));
  assert.ok(matches({ Amount: "-1,234.50" }, { column: "Amount", op: "lt", value: 0 }));
  assert.ok(matches({ Date: "2026-03-05" }, { column: "Date", op: "gte", value: "2026-03-01" }));
  assert.ok(matches({ Reconciled: "No" }, { column: "Reconciled", op: "eq", value: "no" }));
  assert.ok(matches({ Ref: "" }, { column: "Ref", op: "empty" }));

  const rows = Array.from({ length: 450 }, (_, i) => ({ Date: `2026-0${(i % 9) + 1}-10`, Description: `Line ${i}`, Amount: i % 2 ? -i : i, Reconciled: i % 3 ? "Yes" : "No" }));
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify(rows), { status: 200 }); }) as typeof fetch;
  const tool = Tool();
  const url = "https://app.coupler.io/export/w/abc.json?access_token=t";
  let r: any = await tool.handler({ url, limit: 2 }, {});
  assert.match(r.content[0].text, /Export has 450 rows; 450 match/);
  assert.match(r.content[0].text, /Columns: Date, Description, Amount, Reconciled/);
  r = await tool.handler({ url, filters: [{ column: "Reconciled", op: "eq", value: "No" }, { column: "Date", op: "gte", value: "2026-07-01" }], sortBy: "Amount", format: "json" }, {});
  const json = JSON.parse(r.content[0].text.split("\n\n")[1]);
  assert.ok(json.length > 0 && json.every((x: any) => x.Reconciled === "No" && x.Date >= "2026-07-01"));
  assert.ok(json[0].Amount <= json[json.length - 1].Amount);
  r = await tool.handler({ url, filters: [{ column: "Nope", op: "eq", value: 1 }] }, {});
  assert.ok(r.isError && /Available columns/.test(r.content[0].text));
  r = await tool.handler({ url, offset: 400, limit: 100 }, {});
  assert.match(r.content[0].text, /showing 50 \(offset 400\)/);
  assert.equal(calls, 1, "cached between calls");
  await tool.handler({ url, refresh: true, limit: 1 }, {});
  assert.equal(calls, 2);
  r = await tool.handler({ url: "https://example.com/x" }, {});
  assert.ok(r.isError);

});
