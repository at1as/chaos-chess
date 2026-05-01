const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("index.html loads the position encoder before computer-engines", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8"
  );
  const encoderIndex = html.indexOf('<script src="./src/position-encoder.js"></script>');
  const computerIndex = html.indexOf('<script src="./src/computer-engines.js"></script>');

  assert.notEqual(encoderIndex, -1);
  assert.notEqual(computerIndex, -1);
  assert.equal(encoderIndex < computerIndex, true);
});
