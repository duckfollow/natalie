import assert from "node:assert/strict";
import test from "node:test";
import { buildBranchTree } from "../src/branch-tree.ts";

test("local branches become nested folders with natural ordering and intact references", () => {
  const refs = ["s10/feat/LOK-4071", "s08/fix/LOK-3958", "main", "s08/fix/LOK-3965", "s08/feat/another"]
    .map((name, hash) => ({ name, hash: String(hash), ahead: hash }));
  const tree = buildBranchTree(refs);
  assert.deepEqual([...tree.folders.keys()], ["s08", "s10"]);
  assert.equal(tree.branches[0], refs[2]);
  const fix = tree.folders.get("s08")!.folders.get("fix")!;
  assert.equal(fix.path, "s08/fix");
  assert.deepEqual(fix.branches, [refs[1], refs[3]]);
  assert.equal(fix.branches[0].name, "s08/fix/LOK-3958");
  assert.equal(refs[0].name, "s10/feat/LOK-4071");
});

test("remote folders strip only the exact remote prefix and preserve full checkout names", () => {
  const refs = ["team/origin/main", "team/origin/s08/fix/loading-patient", "team/origin/s10/feat/LOK-4071"]
    .map((name) => ({ name, hash: name }));
  const tree = buildBranchTree(refs, "team/origin");
  assert.equal(tree.branches[0], refs[0]);
  const fix = tree.folders.get("s08")!.folders.get("fix")!;
  assert.equal(fix.path, "team/origin/s08/fix");
  assert.equal(fix.branches[0], refs[1]);
  assert.equal(fix.branches[0].name.slice("team/origin/".length), "s08/fix/loading-patient");
  assert.equal(buildBranchTree([]).folders.size, 0);
});
