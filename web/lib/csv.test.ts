import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "./csv.ts";

test("quotes cells with commas, quotes and newlines", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("plain"), "plain");
});

test("neutralizes spreadsheet formula injection in text but leaves real numbers alone", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("-2 hours"), "'-2 hours");
  assert.equal(csvCell(-3.5), "-3.5");
});

test("null/undefined/NaN become empty cells; booleans are literal", () => {
  assert.equal(toCsv(["a", "b", "c", "d"], [[null, undefined, NaN, true]]), "a,b,c,d\n,,,true");
});
