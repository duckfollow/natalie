import assert from "node:assert/strict";
import test from "node:test";
import { canReplaceGeneratedMessage, suggestCommitMessages, type CommitMessageContext, type StagedFile } from "../src/commit-message.ts";

function file(path: string, diff = "", status = "M"): StagedFile {
  return { path, diff, status, binary: false, omitted: false };
}
function context(files: StagedFile[], options: Partial<CommitMessageContext> = {}): CommitMessageContext {
  return { tree: "a".repeat(40), head: null, branch: "main", subjects: [], files, truncated: false, ...options };
}

test("branch tree changes produce focused sidebar titles", () => {
  const result = suggestCommitMessages(context([
    file("src/branch-tree.ts", "+export function buildBranchTree() {\n+ const folders = new Map();", "A"),
    file("src/RepositorySidebar.tsx", "+renderBranches(folder.children)"),
  ]));
  assert.equal(result.messages[0], "feat(sidebar): group branches into nested folders");
  assert.equal(new Set(result.messages).size, 3);
});

test("added guards, styles, documentation and tests use appropriate types", () => {
  const cases = [
    [file("src/validation.ts", "+if (input.length === 0) return null;"), "fix"],
    [file("src/sidebar.css", "+color: red;"), "style"],
    [file("README.md", "+Installation instructions"), "docs"],
    [file("scripts/model.test.ts", "+assert.ok(value);"), "test"],
  ] as const;
  for (const [changed, kind] of cases) assert.equal(suggestCommitMessages(context([changed])).kind, kind);
});

test("Conventional Commits headers are generated for repositories with plain history", () => {
  const english = suggestCommitMessages(context([file("README.md")], { subjects: ["Improve setup", "Update instructions"] }));
  assert.equal(english.messages[0], "docs: update project documentation");
  assert.ok(english.messages.every(message => /^docs: \S/.test(message)));
  const thai = suggestCommitMessages(context([file("README.md")], { subjects: ["docs: ปรับเอกสาร", "fix: แก้ไขการแสดงผล"] }));
  assert.match(thai.messages[0], /^docs: .*เอกสาร/);
  const override = suggestCommitMessages(context([file("README.md")], { subjects: ["Update instructions"] }), "chore");
  assert.match(override.messages[0], /^chore:/);
  const feature = suggestCommitMessages(context([file("src/data.ts", "+export function loadRecords() {}")], { subjects: ["Improve startup", "Release version 1"] }));
  assert.equal(feature.messages[0], "feat(data): load records");
  assert.ok(feature.messages.every(message => /^feat\(data\): \S/.test(message)));
});

test("moves and renames preserve identifiable intent", () => {
  const moved = suggestCommitMessages(context([
    file("src/old.ts", "-export function parseBranch() {}"),
    file("src/shared.ts", "+export function parseBranch() {}", "A"),
  ]));
  assert.equal(moved.kind, "refactor");
  assert.match(moved.messages[0], /move parse branch into a shared module/);
  const renamed = file("src/new-name.ts", "", "R");
  renamed.previous_path = "src/old-name.ts";
  assert.match(suggestCommitMessages(context([renamed])).messages[0], /rename old name to new name/);
});

test("comments and binary contents do not create fictional function summaries", () => {
  const comment = suggestCommitMessages(context([file("src/config.ts", "+// function imaginaryFeature() {}\n+const text = 'function imaginaryFeature() {}';")]));
  assert.ok(comment.messages.every(message => !message.includes("imaginary")));
  const binary = file("assets/logo.png", "", "A");
  binary.binary = true;
  assert.match(suggestCommitMessages(context([binary])).messages[0], /add logo/);
  const lock = file("Cargo.lock");
  lock.omitted = true;
  assert.equal(suggestCommitMessages(context([lock])).kind, "build");
});

test("long declarations still yield three distinct concise titles", () => {
  const result = suggestCommitMessages(context([file("src/components/long-component.ts", "+export function createAnExtremelyLongFunctionNameForAnUnexpectedlyLargeWorkflow() {}", "A")]));
  assert.equal(result.messages.length, 3);
  assert.equal(new Set(result.messages).size, 3);
  assert.ok(result.messages.every(message => message.length <= 72 && !message.includes("\n")));
  const thai = suggestCommitMessages(context([file("src/a-very-long-component-name-for-workflows.ts", "+export function createAnExtremelyLongWorkflowFunctionName() {}", "A")], { subjects: ["feat: เพิ่มฟีเจอร์", "fix: แก้ไขปัญหา"] }), "refactor");
  assert.equal(thai.messages.length, 3);
  assert.equal(new Set(thai.messages).size, 3);
  assert.ok(thai.messages.every(message => message.length <= 72));
  assert.deepEqual(suggestCommitMessages(context([])).messages, []);
});

test("generation replaces the starting draft and preserves edits made during the request", () => {
  assert.equal(canReplaceGeneratedMessage("", ""), true);
  assert.equal(canReplaceGeneratedMessage("My existing draft", "My existing draft"), true);
  assert.equal(canReplaceGeneratedMessage("New manual edit", "My existing draft"), false);
  assert.equal(canReplaceGeneratedMessage("New manual edit", ""), false);
});
