export type CommitKind = "feat" | "fix" | "refactor" | "style" | "docs" | "test" | "perf" | "build" | "ci" | "chore";
export interface StagedFile {
  path: string;
  previous_path?: string | null;
  status: string;
  diff: string;
  binary: boolean;
  omitted: boolean;
}
export interface CommitMessageContext {
  tree: string;
  head: string | null;
  branch: string;
  subjects: string[];
  files: StagedFile[];
  truncated: boolean;
}

const docs = /\.(md|mdx|rst|txt)$|(?:^|\/)(?:licen[cs]e|copying|notice)(?:\.[^/]*)?$/i;
const tests = /(?:^|\/)(?:tests?|__tests__)\/|[.-](?:test|spec)\./i;
const styles = /\.(css|scss|sass|less)$/i;
const dependencyFile = /(?:^|\/)(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.(?:toml|lock)|requirements[^/]*\.txt|go\.(?:mod|sum))$/;

function words(value: string): string {
  return value.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}
function fileTopic(path: string): string {
  return words(path.split("/").at(-1)!.replace(/\.(test|spec)\.[^.]+$|\.[^.]+$/g, ""))
    .replace(/\b(index|main|utils?|model)\b/g, "").replace(/\s+/g, " ").trim();
}
function changedLines(files: StagedFile[], sign: "+" | "-"): string[] {
  return files.flatMap(file => file.diff.split("\n").filter(line => line.startsWith(sign) && !line.startsWith(sign.repeat(3))).map(line => line.slice(1)));
}
function symbols(lines: string[]): Set<string> {
  const result = new Set<string>();
  for (const line of lines) {
    const declaration = line.match(/^\s*(?:(?:export|default|pub(?:\([^)]*\))?|async|unsafe|static|abstract|declare)\s+)*(?:function|fn|def|class|struct|interface|enum|type)\s+([A-Za-z_$][\w$]*)/)
      || line.match(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/)
      || line.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/);
    if (declaration) result.add(declaration[1]);
  }
  return result;
}
function scopeFor(files: StagedFile[]): string {
  const domains: [string, RegExp][] = [
    ["sidebar", /sidebar|navigation|branch.tree/i], ["graph", /graph|history/i],
    ["auth", /credential|auth|password|keychain/i], ["commit", /commit.message|commit.form/i],
    ["connections", /connect|database/i], ["api", /(?:^|\/)api(?:\/|\.)/i],
  ];
  let scope = "";
  let score = 0;
  for (const [name, pattern] of domains) {
    const matches = files.filter(file => pattern.test(file.path)).length;
    if (matches > score) { scope = name; score = matches; }
  }
  if (scope) return scope;
  if (files.length === 1) {
    const name = fileTopic(files[0].path);
    return ["style", "styles", "global", "globals", "app", "common"].includes(name) ? ""
      : name.replace(/ /g, "-").replace(/[^\p{L}\p{N}-]/gu, "").slice(0, 24);
  }
  const folders = files.map(file => file.path.split("/").slice(0, -1).filter(part => !["src", "src-tauri", "lib", "app", "components"].includes(part)));
  const common = folders[0]?.find(part => folders.every(folder => folder.includes(part)));
  return common?.replace(/[^\p{L}\p{N}-]/gu, "").slice(0, 24) || "";
}
function branchKind(branch: string): CommitKind | undefined {
  const match = branch.match(/(?:^|\/)(feat(?:ure)?|fix|bugfix|hotfix|refactor|style|docs|test|perf|build|ci|chore)(?:\/|[-_])/i);
  if (!match) return undefined;
  const value = match[1].toLowerCase();
  if (value === "feature") return "feat";
  if (value === "bugfix" || value === "hotfix") return "fix";
  return value as CommitKind;
}

export function suggestCommitMessages(context: CommitMessageContext, override?: CommitKind) {
  if (!context.files.length) return { kind: "chore" as CommitKind, messages: [] };
  const useful = context.files.filter(file => !file.omitted && !file.binary);
  const code = useful.filter(file => !docs.test(file.path) && !tests.test(file.path));
  const relevant = code.length ? code : useful.length ? useful : context.files;
  let scope = scopeFor(relevant);
  const added = changedLines(useful, "+");
  const removed = changedLines(useful, "-");
  const addedSymbols = symbols(added);
  const removedSymbols = symbols(removed);
  const actionWord = /^(add|build|create|load|save|read|write|parse|validate|render|group|sort|update|remove|handle|check|suggest|draft|generate|fetch|connect|delete|list)\b/;
  const symbolScore = (name: string) => (actionWord.test(words(name)) ? 2 : 0) + (scope && words(name).includes(words(scope)) ? 1 : 0);
  const newSymbols = [...addedSymbols].filter(name => !removedSymbols.has(name)).sort((a, b) => symbolScore(b) - symbolScore(a));
  const movedSymbols = useful.filter(file => file.status === "A").flatMap(file =>
    [...symbols(changedLines([file], "+"))].filter(name => useful.some(other =>
      other.path !== file.path && symbols(changedLines([other], "-")).has(name))));
  const text = added.join("\n");
  const all = (pattern: RegExp) => context.files.every(file => pattern.test(file.path));
  const topics = [...new Set(relevant.map(file => fileTopic(file.path)).filter(Boolean))];
  const inferredTopic = scope ? words(scope) : topics.slice(0, 2).join(" and ") || "project files";
  const topic = inferredTopic.length > 42 ? `${relevant.length} project files` : inferredTopic;
  let kind: CommitKind = branchKind(context.branch) || (context.files.some(file => file.status === "A") ? "feat" : "chore");
  let english = [`update ${topic}`, `refine ${topic} behavior`, `revise ${topic} implementation`];
  let thai = [`ปรับปรุง ${topic}`, `ปรับการทำงานของ ${topic}`, `ปรับโครงสร้างการทำงานของ ${topic}`];

  if (all(docs)) {
    kind = "docs"; scope = "";
    english = ["update project documentation", "revise project documentation", "refresh project documentation"];
    thai = ["ปรับปรุงเอกสารโปรเจกต์", "ปรับเนื้อหาเอกสารโปรเจกต์", "ปรับรายละเอียดในเอกสารโปรเจกต์"];
  } else if (all(tests)) {
    kind = "test";
    english = [`update ${topic} tests`, `refine ${topic} test cases`, `revise checks for ${topic}`];
    thai = [`ปรับปรุงการทดสอบ ${topic}`, `ปรับกรณีทดสอบ ${topic}`, `ปรับการตรวจสอบ ${topic}`];
  } else if (all(styles)) {
    kind = "style";
    english = [`refine ${scope ? topic : "interface"} styling`, "adjust interface appearance", "update interface styles"];
    thai = [`ปรับรูปแบบหน้าตา ${scope ? topic : "ของแอป"}`, "ปรับการแสดงผลส่วนติดต่อผู้ใช้", "ปรับปรุงสไตล์ส่วนติดต่อผู้ใช้"];
  } else if (all(dependencyFile)) {
    kind = "build"; scope = "deps";
    english = ["update dependency configuration", "refresh package metadata and lockfiles", "revise project dependency settings"];
    thai = ["ปรับการตั้งค่า dependency", "ปรับข้อมูลแพ็กเกจและ lockfile", "ปรับการกำหนด dependency ของโปรเจกต์"];
  } else if (context.files.every(file => file.path.startsWith(".github/"))) {
    kind = "ci"; scope = "";
    english = ["update CI workflows", "revise automation configuration", "adjust continuous integration settings"];
    thai = ["ปรับปรุงขั้นตอน CI", "ปรับการตั้งค่าระบบอัตโนมัติ", "ปรับการทำงานของ continuous integration"];
  } else if (context.files.every(file => file.status === "R")) {
    kind = "refactor";
    const file = context.files[0];
    english = [`rename ${fileTopic(file.previous_path || file.path)} to ${fileTopic(file.path)}`, `reorganize ${topic} files`, `update ${topic} file names`];
    thai = [`เปลี่ยนชื่อ ${fileTopic(file.previous_path || file.path)} เป็น ${fileTopic(file.path)}`, `จัดระเบียบไฟล์ ${topic}`, `ปรับชื่อไฟล์ ${topic}`];
  } else if (context.files.every(file => file.status === "D")) {
    kind = "chore";
    english = [`remove ${topic}`, `delete ${topic} files`, `clean up ${topic}`];
    thai = [`นำ ${topic} ออก`, `ลบไฟล์ ${topic}`, `จัดระเบียบ ${topic}`];
  } else if (scope === "commit" && /suggestCommitMessages|commit_message_context|commit-message-suggestions/.test(text)) {
    kind = branchKind(context.branch) || "feat";
    english = ["suggest commit messages from staged changes", "add local commit message suggestions", "draft commit messages from staged diffs"];
    thai = ["แนะนำข้อความ commit จาก staged changes", "เพิ่มตัวช่วยร่างข้อความ commit ในเครื่อง", "ร่างข้อความ commit จาก staged diff"];
  } else if (scope === "sidebar" && /folders|buildBranchTree|children/.test(text) && relevant.some(file => /branch|sidebar/i.test(file.path))) {
    kind = branchKind(context.branch) || "feat";
    english = ["group branches into nested folders", "organize branch navigation by path", "add hierarchical branch browsing"];
    thai = ["จัด branch เป็นโฟลเดอร์ซ้อน", "จัดเมนู branch ตามเส้นทาง", "เพิ่มการแสดง branch แบบลำดับชั้น"];
  } else if (scope === "graph" && /origin_only|remote_only/.test(text) && /dashed|strokeDasharray/.test(text)) {
    kind = branchKind(context.branch) || "feat";
    english = ["distinguish remote-only branches with dashed lines", "show dashed lines for remote-only history", "update remote branch graph styling"];
    thai = ["แยก branch บน remote ด้วยเส้นประ", "แสดงประวัติบน remote ด้วยเส้นประ", "ปรับรูปแบบกราฟ branch บน remote"];
  } else if (/\bif\b[^\n]*(?:\.is_empty\(|(?:==|===)\s*(?:null|undefined)|\.length\s*(?:==|===)\s*0|!\s*(?:input|value|message|text)\b)/.test(text)) {
    kind = branchKind(context.branch) || "fix";
    english = ["handle empty input values", "validate input before processing", "guard against missing input"];
    thai = ["รองรับข้อมูลนำเข้าที่ว่าง", "ตรวจสอบข้อมูลก่อนประมวลผล", "เพิ่มการตรวจสอบข้อมูลที่ขาดหาย"];
  } else if (movedSymbols.length && context.files.some(file => file.status === "A" || file.status === "D")) {
    kind = branchKind(context.branch) || "refactor";
    const symbol = words(movedSymbols[0]);
    english = [`move ${symbol} into a shared module`, `reorganize ${topic} implementation`, `extract shared ${topic} logic`];
    thai = [`ย้าย ${symbol} ไปยังโมดูลร่วม`, `จัดโครงสร้างโค้ด ${topic}`, `แยกโค้ด ${topic} ที่ใช้ร่วมกัน`];
  } else if (newSymbols.length) {
    kind = branchKind(context.branch) || "feat";
    const symbol = words(newSymbols[0]);
    const action = actionWord.test(symbol) ? symbol : `add ${symbol}`;
    english = [action, `add ${topic} handling`, `extend ${topic} functionality`];
    thai = [`เพิ่มการทำงาน ${symbol}`, `เพิ่มการจัดการ ${topic}`, `ขยายความสามารถของ ${topic}`];
  } else if (context.files.every(file => file.status === "A")) {
    english = [`add ${topic}`, `introduce ${topic}`, `add ${topic} files`];
    thai = [`เพิ่ม ${topic}`, `เพิ่มการใช้งาน ${topic}`, `เพิ่มไฟล์ ${topic}`];
  } else if (kind === "fix") {
    english = [`fix ${topic} handling`, `correct ${topic} behavior`, `adjust ${topic} processing`];
    thai = [`แก้ไขการจัดการ ${topic}`, `แก้ไขการทำงานของ ${topic}`, `ปรับการประมวลผล ${topic}`];
  }
  kind = override || kind;
  const subjects = context.subjects.filter(Boolean);
  const useThai = subjects.filter(subject => /[\u0e00-\u0e7f]/.test(subject)).length > subjects.length / 2;
  const format = (subject: string) => {
    const prefix = `${kind}${scope ? `(${scope})` : ""}: `;
    let title = subject;
    if ((prefix + title).length > 72) {
      title = useThai ? `ปรับปรุง ${topic}` : `update ${topic}`;
    }
    return prefix + title;
  };
  const messages = [...new Set((useThai ? thai : english).map(format))];
  const fallback = useThai ? [`ปรับปรุง ${topic}`, `ปรับรายละเอียด ${topic}`, `ปรับการทำงาน ${topic}`]
    : [`update ${topic}`, `adjust ${topic}`, `refine ${topic}`];
  for (const subject of fallback) {
    const message = format(subject);
    if (!messages.includes(message)) messages.push(message);
    if (messages.length >= 3) break;
  }
  if (messages.length < 3) {
    const concise = useThai ? ["ปรับปรุงส่วนที่เปลี่ยน", "ปรับรายละเอียดโค้ด", "ปรับการทำงานของโปรเจกต์"]
      : ["update staged changes", "refine project behavior", "revise project implementation"];
    for (const subject of concise) {
      const message = format(subject);
      if (!messages.includes(message)) messages.push(message);
      if (messages.length >= 3) break;
    }
  }
  return { kind, messages: messages.slice(0, 3) };
}

export function canReplaceGeneratedMessage(current: string, startedWith: string): boolean {
  return current === startedWith;
}

export type MessageDetail = "short" | "detailed" | "analysis";

export function formatCommitMessage(title: string, context: CommitMessageContext, detail: MessageDetail): string {
  if (detail === "short") return title;
  const statusNames: Record<string, string> = { A: "Add", D: "Remove", R: "Rename", C: "Copy", M: "Update", T: "Change type of" };
  const files = context.files.slice(0, 20).map(file => {
    const name = file.path.replace(/[\r\n\x00-\x1f]/g, " ");
    const previous = file.previous_path?.replace(/[\r\n\x00-\x1f]/g, " ");
    const path = previous ? `${previous} → ${name}` : name;
    return `- ${statusNames[file.status] || "Update"} ${path}${file.binary ? " (binary)" : ""}`;
  });
  if (context.files.length > 20) files.push(`- ${context.files.length - 20} more staged files`);
  const body = [title, "", ...files];
  if (detail === "analysis") {
    const analyzed = context.files.filter(file => !file.binary && !file.omitted);
    const added = changedLines(analyzed, "+").length;
    const removed = changedLines(analyzed, "-").length;
    body.push("", `Staged scope: ${context.files.length} files; ${added} added and ${removed} removed lines in the analyzed diff.`);
    if (context.truncated || context.files.some(file => file.omitted)) {
      body.push("Some staged content was omitted or shortened during analysis.");
    }
  }
  return body.join("\n");
}
