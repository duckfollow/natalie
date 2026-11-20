import assert from "node:assert/strict";
import test from "node:test";
import { modelPrompt, modelTitle } from "../src/commit-message-ai.ts";

test("model input is bounded and excludes binary and omitted contents", () => {
  const context = {
    tree: "a".repeat(40), head: null, branch: "main", subjects: [], truncated: true,
    files: [
      { path: "src/app.ts", status: "M", diff: "+function changed() {}\n".repeat(10000), binary: false, omitted: false },
      { path: "secret.bin", status: "A", diff: "BINARY_SECRET", binary: true, omitted: false },
      { path: "Cargo.lock", status: "M", diff: "OMITTED_SECRET", binary: false, omitted: true },
    ],
  };
  const prompt = modelPrompt(context);
  assert.ok(prompt.length < 6000);
  assert.ok(prompt.includes("src/app.ts"));
  assert.ok(!prompt.includes("BINARY_SECRET"));
  assert.ok(!prompt.includes("OMITTED_SECRET"));
});

test("invalid or verbose model output is rejected for rule fallback", () => {
  assert.equal(modelTitle("feat(graph): show incoming commits"), "feat(graph): show incoming commits");
  for (const value of [null, "", "Sure, here is a message:", "feat: one\nfix: two", "feat: " + "a".repeat(100)]) {
    assert.equal(modelTitle(value), null);
  }
});

test("small model title survives trailing code without inserting code into the draft", () => {
  assert.equal(modelTitle("fix(history): reject empty commits;\n+if (!commits.length) return [];"),
    "fix(history): reject empty commits");
  assert.equal(modelTitle("Here is a title:\nfix(history): reject empty commits"), "fix(history): reject empty commits");
});

test("plain imperative subjects reuse the staged analysis prefix", () => {
  assert.equal(modelTitle('Update branch navigation', 'feat(sidebar): update sidebar'), 'feat(sidebar): update branch navigation');
  assert.equal(modelTitle('"fix: reject empty usernames"'), 'fix: reject empty usernames');
  assert.equal(modelTitle('Commit message: fix: reject empty usernames'), 'fix: reject empty usernames');
  assert.equal(modelTitle('You can update the code', 'feat: update code'), null);
  assert.equal(modelTitle('return { value: true }', 'feat: update code'), null);
});


test("extracts a single markdown formatted title and rejects ambiguous answers", () => {
  assert.equal(modelTitle('Here is the commit message:\n```\nfeat: add branch preview\n```'), 'feat: add branch preview');
  assert.equal(modelTitle('- **fix: handle empty input**'), 'fix: handle empty input');
  assert.equal(modelTitle('feat: add branch preview\nfix: handle empty input'), null);
});


test("AI ranking chooses a supplied candidate and rejects invalid logits", async () => {
  const { bestCandidate } = await import("../src/commit-message-ranking.ts");
  assert.equal(bestCandidate([-4, 2, 1]), 1);
  assert.equal(bestCandidate([2, 2, 1]), 0);
  assert.throws(() => bestCandidate([]));
  assert.throws(() => bestCandidate([NaN, 1]));
});

test("model catalog resolves pinned Q4 choices and rejects unknown IDs", async () => {
  const { commitModels, commitModel } = await import("../src/commit-models.ts");
  assert.equal(commitModels.length, 2);
  for (const model of commitModels) {
    assert.equal(commitModel(model.id), model);
    assert.match(model.revision, /^[0-9a-f]{40}$/);
    assert.ok(model.timeout >= 180000);
  }
  assert.throws(() => commitModel("../../custom"));
});
