export function splitDiff(text: string) {
  const lines = text.split("\n");
  const starts = lines.flatMap((line, index) =>
    line.startsWith("diff --git ") ? [index] : [],
  );
  const files = starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    const patch = lines.slice(start, end);
    const hunk = patch.findIndex((line) => line.startsWith("@@"));
    const header = hunk < 0 ? patch : patch.slice(0, hunk);
    const destination = header.find(
      (line) => line.startsWith("+++ ") && line !== "+++ /dev/null",
    );
    const source = header.find(
      (line) => line.startsWith("--- ") && line !== "--- /dev/null",
    );
    const rename = header.find((line) => line.startsWith("rename to "));
    const path =
      rename?.slice(10) ??
      (destination ?? source)
        ?.slice(4)
        .replace(/\t$/, "")
        .replace(/^[ab]\//, "") ??
      patch[0].slice("diff --git ".length);
    const imageBlobs = header
      .find((line) => /^index [a-f0-9]{40,64}\.\.[a-f0-9]{40,64}(?: |$)/.test(line))
      ?.split(" ")[1].split("..");
    const changes = hunk < 0 ? [] : patch.slice(hunk);
    return {
      path,
      imageBlobs,
      metadata: hunk < 0 ? [] : header,
      lines: hunk < 0 ? patch : changes,
      additions: changes.filter((line) => line.startsWith("+")).length,
      deletions: changes.filter((line) => line.startsWith("-")).length,
    };
  });
  return { intro: lines.slice(0, starts[0] ?? lines.length), files };
}
