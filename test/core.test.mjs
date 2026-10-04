import assert from "node:assert/strict";

import { booleanValue, escapeHtml, redactSessionUrls } from "../src/core.js";

assert.equal(escapeHtml('a < b & "c" > d'), "a &lt; b &amp; &quot;c&quot; &gt; d");
assert.equal(escapeHtml(123), "123");

assert.equal(booleanValue("TRUE"), true);
assert.equal(booleanValue("si"), true);
assert.equal(booleanValue("no"), false);
assert.equal(booleanValue(undefined, true), true);
assert.equal(booleanValue("", true), true);

assert.equal(
  redactSessionUrls('<a href="recibirDDJJContribuyente.do?_cyp=AbC123%3D&x=1">'),
  '<a href="recibirDDJJContribuyente.do?_cyp=REDACTED&x=1">'
);
assert.equal(
  redactSessionUrls("gdi/presentacionTalonResumen.do?_cyp=zz9 resto"),
  "gdi/presentacionTalonResumen.do?_cyp=REDACTED resto"
);

console.log("Core tests passed.");
