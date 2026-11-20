import assert from "node:assert/strict";
import test from "node:test";
import { layoutHistory, type Commit } from "../src/history-graph.ts";

function commit(hash: string, parents: string[], flags: Partial<Commit> = {}): Commit {
  return { hash, parents, author: "Test", date: "", subject: hash, refs: "",
    local_only: false, incoming: false, incoming_for_pull: false, incoming_branches: [], ...flags };
}

test("origin-only edges stay dashed through ancestry and stop at shared local history", () => {
  const graph = layoutHistory([
    commit("local", ["shared"]),
    commit("remote-tip", ["remote-parent"], { origin_only: true }),
    commit("remote-parent", ["shared"], { origin_only: true }),
    commit("shared", ["base"]),
    commit("base", []),
  ]);
  for (const hash of ["remote-tip", "remote-parent"]) {
    const edges = graph.rows.flatMap(row => row.edges).filter(edge => edge.sourceHash === hash);
    assert.ok(edges.length > 0);
    assert.ok(edges.every(edge => edge.dashed));
  }
  assert.ok(graph.rows[2].edges.some(edge => edge.part === "top" && edge.dashed));
  assert.ok(graph.rows[3].edges.filter(edge => edge.part === "bottom").every(edge => !edge.dashed));
  assert.ok(graph.rows[0].edges.every(edge => !edge.dashed));
});

test("existing local-only and incoming styles remain dashed without an origin-only field", () => {
  for (const flags of [{ local_only: true }, { incoming: true }]) {
    const graph = layoutHistory([commit("tip", ["base"], flags), commit("base", [])]);
    assert.ok(graph.rows[0].edges.every(edge => edge.dashed));
  }
  const graph = layoutHistory([commit("tip", ["base"]), commit("base", [])]);
  assert.ok(graph.rows[0].edges.every(edge => !edge.dashed));
});
