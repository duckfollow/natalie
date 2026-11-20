#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod updates;
mod commit_message;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    hash::{DefaultHasher, Hash, Hasher},
    io::{Read, Write},
    path::Path,
    process::{Command, Output, Stdio},
};

#[derive(Hash, Serialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    path: String,
    index: char,
    worktree: char,
}

#[derive(Serialize)]
struct Commit {
    hash: String,
    author: String,
    date: String,
    subject: String,
    parents: Vec<String>,
    refs: String,
    local_only: bool,
    origin_only: bool,
    incoming: bool,
    incoming_for_pull: bool,
    incoming_branches: Vec<String>,
}

#[derive(Serialize)]
struct Reference {
    name: String,
    hash: String,
}

#[derive(Serialize)]
struct RecentOriginBranch {
    #[serde(flatten)]
    reference: Reference,
    author: String,
    date: String,
}

#[derive(Serialize)]
struct LocalBranch {
    #[serde(flatten)]
    reference: Reference,
    ahead: Option<usize>,
    behind: Option<usize>,
    #[serde(skip)]
    upstream: String,
}

#[derive(Serialize)]
struct Snapshot {
    root: String,
    repo_version: String,
    branch: String,
    head: Option<String>,
    changes: Vec<Change>,
    commits: Vec<Commit>,
    branches: Vec<LocalBranch>,
    tags: Vec<Reference>,
    remotes: Vec<String>,
    remote_branches: Vec<Reference>,
    recent_origin_branches: Vec<RecentOriginBranch>,
    origin_url: Option<String>,
    stashes: Vec<Reference>,
    submodules: Vec<String>,
    cherry_picking: bool,
    rebasing: bool,
    has_upstream: bool,
    ahead: Option<usize>,
    behind: Option<usize>,
}

fn run(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("/usr/bin/git");
    command
        .current_dir(root)
        .args(["--no-pager", "-c", "core.quotePath=false"]);
    // Only commands receiving a file path need literal pathspecs. Stash uses
    // Git's own pathspec patterns when cleaning up untracked files.
    if matches!(
        args.first().copied(),
        Some("diff" | "add" | "restore" | "rm" | "clean" | "ls-tree" | "ls-files")
    ) {
        command.arg("--literal-pathspecs");
    }
    if args == ["cherry-pick", "--continue"] || args == ["rebase", "--continue"] {
        command.env("GIT_EDITOR", "true");
    }
    command
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| format!("Could not start Git: {error}"))
}

fn output(result: Output, allow_difference: bool) -> Result<String, String> {
    if !result.status.success() && !(allow_difference && result.status.code() == Some(1)) {
        let message = String::from_utf8_lossy(&result.stderr);
        return Err(if message.trim().is_empty() {
            format!("Git exited with {}", result.status)
        } else {
            message.trim().to_string()
        });
    }
    Ok(String::from_utf8_lossy(&result.stdout).into_owned())
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    output(run(root, args)?, false)
}

#[derive(Default)]
struct IncomingCommits {
    all: HashMap<String, Vec<String>>,
    for_pull: HashSet<String>,
}

fn local_branches(path: &Path) -> Result<(Vec<LocalBranch>, IncomingCommits), String> {
    let tracking = git(
        path,
        &[
            "for-each-ref",
            "--format=%(objectname)%09%(refname:strip=2)%09%(upstream)%09%(HEAD)",
            "refs/heads",
        ],
    )?;
    let mut branches = Vec::new();
    let mut incoming = IncomingCommits::default();
    for line in tracking.lines() {
        let mut fields = line.split('\t');
        let (Some(hash), Some(name), Some(upstream), Some(head)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let mut branch = LocalBranch {
            reference: Reference { name: name.to_owned(), hash: hash.to_owned() },
            ahead: None,
            behind: None,
            upstream: upstream.to_owned(),
        };
        if !upstream.is_empty() {
            let range = format!("{hash}...{upstream}");
            // An upstream can be pruned while its tracking config is still present.
            if let Ok(commits) = git(path, &["rev-list", "--left-right", &range, "--"]) {
                let mut ahead = 0;
                let mut behind = 0;
                for commit in commits.lines() {
                    if let Some(hash) = commit.strip_prefix('>') {
                        behind += 1;
                        if upstream.starts_with("refs/remotes/") {
                            incoming.all.entry(hash.to_owned()).or_default().push(name.to_owned());
                        }
                    } else {
                        ahead += 1;
                    }
                }
                if head == "*" && ahead == 0 && upstream.starts_with("refs/remotes/") {
                    incoming.for_pull.extend(
                        commits.lines().filter_map(|commit| commit.strip_prefix('>')).map(str::to_owned),
                    );
                }
                branch.ahead = Some(ahead);
                branch.behind = Some(behind);
            }
        }
        branches.push(branch);
    }
    Ok((branches, incoming))
}

fn origin_branches(path: &Path) -> Result<Vec<RecentOriginBranch>, String> {
    let refs = git(path, &[
        "for-each-ref", "--sort=refname", "--sort=-committerdate",
        "--format=%(refname:strip=2)%00%(objectname)%00%(symref)%00%(authorname)%00%(committerdate:iso-strict)",
        "refs/remotes/origin/",
    ])?;
    Ok(refs
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let (Some(name), Some(hash), Some(symref), Some(author), Some(date)) = (
                fields.next(),
                fields.next(),
                fields.next(),
                fields.next(),
                fields.next(),
            ) else {
                return None;
            };
            if !symref.is_empty() {
                return None;
            }
            Some(RecentOriginBranch {
                reference: Reference {
                    name: name.into(),
                    hash: hash.into(),
                },
                author: author.into(),
                date: date.into(),
            })
        })
        .collect())
}

fn has_local_origin_branch(name: &str, branches: &[LocalBranch]) -> bool {
    branches.iter().any(|branch| {
        branch.upstream == format!("refs/remotes/{name}")
            || Some(branch.reference.name.as_str()) == name.strip_prefix("origin/")
    })
}

fn recent_origin_branches(
    path: &Path,
    branches: &[LocalBranch],
) -> Result<Vec<RecentOriginBranch>, String> {
    Ok(origin_branches(path)?
        .into_iter()
        .filter(|branch| !has_local_origin_branch(&branch.reference.name, branches))
        .take(5)
        .collect())
}

fn origin_only_commits(path: &Path, branches: &[LocalBranch]) -> Result<HashSet<String>, String> {
    let (tracked, untracked): (Vec<_>, Vec<_>) = origin_branches(path)?
        .into_iter()
        .partition(|branch| has_local_origin_branch(&branch.reference.name, branches));
    if untracked.is_empty() {
        return Ok(HashSet::new());
    }
    let mut args = vec!["rev-list".to_owned()];
    args.extend(
        untracked
            .iter()
            .map(|branch| format!("refs/remotes/{}", branch.reference.name)),
    );
    args.extend(["--not".to_owned(), "--branches".to_owned()]);
    if git(path, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        args.push("HEAD".into());
    }
    // Shared history follows the local/tracked branch's existing visual state.
    args.extend(
        tracked
            .iter()
            .map(|branch| format!("refs/remotes/{}", branch.reference.name)),
    );
    args.push("--".into());
    let hashes = git(path, &args.iter().map(String::as_str).collect::<Vec<_>>())?;
    Ok(hashes.lines().map(str::to_owned).collect())
}

fn branch_history(
    path: &Path,
    branches: &[LocalBranch],
    incoming: &IncomingCommits,
    skip: usize,
    limit: usize,
) -> Result<Vec<Commit>, String> {
    let mut upstreams: Vec<_> = branches
        .iter()
        .filter(|branch| {
            branch.behind.unwrap_or(0) > 0 && branch.upstream.starts_with("refs/remotes/")
        })
        .map(|branch| branch.upstream.as_str())
        .collect();
    upstreams.sort_unstable();
    upstreams.dedup();
    let recent = recent_origin_branches(path, branches)?;
    let recent_refs: Vec<_> = recent
        .iter()
        .map(|branch| format!("refs/remotes/{}", branch.reference.name))
        .collect();
    let mut revisions = vec!["--branches"];
    if git(path, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        revisions.push("HEAD");
    }
    revisions.extend(upstreams);
    revisions.extend(recent_refs.iter().map(String::as_str));
    history(path, &revisions, incoming, branches, skip, limit)
}
fn history(
    path: &Path,
    revisions: &[&str],
    incoming: &IncomingCommits,
    branches: &[LocalBranch],
    skip: usize,
    limit: usize,
) -> Result<Vec<Commit>, String> {
    let skip = format!("--skip={skip}");
    let limit = limit.to_string();
    let mut args = vec![
        "log",
        "-z",
        "--topo-order",
        "--decorate=short",
        "-n",
        &limit,
        &skip,
        "--format=%H%x00%an%x00%aI%x00%s%x00%P%x00%D",
    ];
    args.extend_from_slice(revisions);
    args.push("--");
    let log = git(path, &args)?;
    let mut local_args = vec!["rev-list"];
    local_args.extend_from_slice(revisions);
    local_args.extend(["--not", "--remotes=origin", "--"]);
    let local_hashes = git(path, &local_args)?;
    let local_hashes: std::collections::HashSet<_> = local_hashes.lines().collect();
    let origin_only = origin_only_commits(path, branches)?;
    let fields: Vec<_> = log.strip_suffix('\0').unwrap_or(&log).split('\0').collect();
    Ok(fields
        .chunks_exact(6)
        .map(|record| Commit {
            hash: record[0].to_owned(),
            author: record[1].to_owned(),
            date: record[2].to_owned(),
            subject: record[3].to_owned(),
            parents: record[4].split_whitespace().map(str::to_owned).collect(),
            refs: record[5].to_owned(),
            local_only: local_hashes.contains(record[0]),
            origin_only: origin_only.contains(record[0]),
            incoming: incoming.all.contains_key(record[0]),
            incoming_for_pull: incoming.for_pull.contains(record[0]),
            incoming_branches: incoming.all.get(record[0]).cloned().unwrap_or_default(),
        })
        .collect())
}

fn has_upstream(root: &Path, branch: &str) -> Result<bool, String> {
    let reference = format!("refs/heads/{branch}");
    let upstream = git(root, &["for-each-ref", "--format=%(upstream)", &reference])?;
    Ok(!upstream.trim().is_empty())
}

fn working_changes(root: &Path) -> Result<Vec<Change>, String> {
    let status = run(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--no-renames",
        ],
    )?;
    if !status.status.success() {
        return Err(output(status, false).unwrap_err());
    }
    status
        .stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .map(|entry| {
            let filename = entry.get(3..).ok_or("Unexpected Git status record.")?;
            let path = std::str::from_utf8(filename)
                .map_err(|_| "This repository contains a filename that is not valid UTF-8.")?;
            Ok(Change {
                path: path.to_owned(),
                index: entry[0] as char,
                worktree: entry[1] as char,
            })
        })
        .collect()
}

fn repo_version(root: &Path, branch: Option<&str>, changes: &[Change]) -> Result<String, String> {
    let refs = output(run(root, &["show-ref", "--head"])?, true)?;
    let mut hash = DefaultHasher::new();
    (branch, refs, changes).hash(&mut hash);
    Ok(format!("{:016x}", hash.finish()))
}

fn rebase_in_progress(root: &Path) -> Result<bool, String> {
    for name in ["rebase-merge", "rebase-apply"] {
        let path = git(root, &["rev-parse", "--path-format=absolute", "--git-path", name])?;
        if Path::new(path.trim_end_matches('\n')).is_dir() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn snapshot(folder: &Path) -> Result<Snapshot, String> {
    let root = git(folder, &["rev-parse", "--show-toplevel"])?;
    let root = root.trim_end_matches('\n').to_owned();
    let path = Path::new(&root);
    let branch = git(path, &["symbolic-ref", "--quiet", "HEAD"]).ok();
    let changes = working_changes(path)?;
    let repo_version = repo_version(path, branch.as_deref(), &changes)?;
    let head = git(path, &["rev-parse", "--verify", "HEAD"])
        .ok()
        .map(|hash| hash.trim_end().to_owned());
    let branch = branch.as_deref().and_then(|name| name.trim_end().strip_prefix("refs/heads/"));
    let (branches, incoming) = local_branches(path)?;
    let current_branch = branches.iter().find(|local| Some(local.reference.name.as_str()) == branch);
    let branch = branch.unwrap_or("Detached HEAD").to_owned();
    let has_upstream = current_branch.is_some_and(|local| !local.upstream.is_empty());
    let ahead = current_branch.and_then(|local| local.ahead);
    let behind = current_branch.and_then(|local| local.behind);
    let recent_origin_branches = recent_origin_branches(path, &branches)?;
    let commits = if head.is_some() || !recent_origin_branches.is_empty() {
        branch_history(path, &branches, &incoming, 0, 100)?
    } else {
        Vec::new()
    };
    let references = |args: &[&str]| -> Result<Vec<Reference>, String> {
        Ok(git(path, args)?
            .lines()
            .filter_map(|line| {
                let (hash, name) = line.split_once('\0')?;
                let name = match name.split_once('\0') {
                    Some((name, "")) => name,
                    Some(_) => return None,
                    None => name,
                };
                Some(Reference {
                    name: name.to_owned(),
                    hash: hash.to_owned(),
                })
            })
            .collect())
    };
    let tags = references(&[
        "for-each-ref",
        "--format=%(objectname)%00%(refname:strip=2)",
        "refs/tags",
    ])?;
    let remotes = git(path, &["remote"])?.lines().map(str::to_owned).collect();
    let remote_branches = references(&[
        "for-each-ref",
        "--format=%(objectname)%00%(refname:strip=2)%00%(symref)",
        "refs/remotes",
    ])?;
    let origin_url = git(path, &["config", "--get", "remote.origin.url"])
        .ok()
        .map(|url| url.trim_end().to_owned());
    let stashes = references(&["stash", "list", "--format=%H%x00%gd · %gs"])?;
    let mut submodules: Vec<_> = git(path, &["ls-files", "--stage", "-z"])?
        .split('\0')
        .filter_map(|entry| {
            entry
                .strip_prefix("160000 ")?
                .split_once('\t')
                .map(|(_, name)| name.to_owned())
        })
        .collect();
    submodules.dedup();
    let cherry_picking = run(
        path,
        &["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"],
    )?
    .status
    .success();
    let rebasing = rebase_in_progress(path)?;
    Ok(Snapshot {
        root,
        repo_version,
        branch,
        head,
        changes,
        commits,
        branches,
        tags,
        remotes,
        remote_branches,
        recent_origin_branches,
        origin_url,
        stashes,
        submodules,
        cherry_picking,
        rebasing,
        has_upstream,
        ahead,
        behind,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ConflictResolution {
    Current,
    Incoming,
    MarkResolved,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Action {
    CommitMessageContext,
    CheckCommitMessageIndex { tree: String, head: Option<String>, branch: String },
    Open {
        folder: String,
    },
    Clone {
        url: String,
        parent: String,
        name: String,
    },
    RefreshIfChanged {
        repo_version: String,
    },
    Diff {
        path: String,
        staged: bool,
        untracked: bool,
    },
    ImagePreview {
        path: String,
        staged: bool,
    },
    CommitImagePreview {
        before: String,
        after: String,
    },
    ResolveConflict {
        path: String,
        resolution: ConflictResolution,
    },
    ApplyHunk {
        path: String,
        staged: bool,
        expected_diff: String,
        hunk: usize,
    },
    StageAll,
    UnstageAll,
    Stage {
        path: String,
    },
    Unstage {
        path: String,
    },
    Discard {
        path: String,
    },
    DiscardMany {
        paths: Vec<String>,
    },
    Commit {
        message: String,
    },
    SaveHttpsCredential {
        remote: String,
        username: String,
        token: String,
    },
    SetOrigin {
        url: String,
    },
    Fetch,
    Pull,
    Push,
    PublishBranch {
        branch: String,
        remote: String,
    },
    Branch {
        name: String,
        start: Option<String>,
    },
    Tag {
        name: String,
        hash: String,
    },
    DeleteTag {
        name: String,
    },
    RenameBranch {
        branch: String,
        name: String,
    },
    DeleteBranch {
        branch: String,
    },
    CheckoutCommit {
        hash: String,
    },
    CheckoutBranch {
        branch: String,
    },
    CheckoutRemote {
        remote: String,
        branch: String,
    },
    Merge {
        branch: String,
    },
    Stash {
        message: String,
    },
    CherryPick {
        hash: String,
        mainline: Option<usize>,
        #[serde(default)]
        no_commit: bool,
    },
    ForcePushPlan,
    ForcePush { plan: ForcePushPlan },
    CheckSoftReset { hash: String, branch: String, head: String },
    ResetSoft {
        hash: String,
        branch: String,
        head: String,
    },
    RebasePreview,
    RebaseUpstream { branch: String, head: String, upstream: String },
    ContinueRebase,
    AbortRebase,
    ContinueCherryPick,
    AbortCherryPick,
    OlderHistory {
        hash: Option<String>,
        offset: usize,
        anchor: String,
    },
    History {
        hash: String,
    },
    Show {
        hash: String,
    },
}

#[derive(Serialize)]
struct ImagePreview {
    before: Option<String>,
    after: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    CommitMessageContext(commit_message::CommitMessageContext),
    Snapshot(Snapshot),
    Unchanged(()),
    Text(String),
    ImagePreview(ImagePreview),
    History(Vec<Commit>),
    ForcePushPlan(ForcePushPlan),
    RebasePreview(RebasePreview),
}

fn validate_commit_hash(hash: &str) -> Result<(), String> {
    if matches!(hash.len(), 40 | 64) && hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Invalid commit hash.".into())
    }
}

fn checkout_branch(root: &Path, branch: &str) -> Result<(), String> {
    let reference = format!("refs/heads/{branch}");
    git(root, &["check-ref-format", &reference])?;
    git(root, &["show-ref", "--verify", &reference])?;
    git(
        root,
        &[
            "switch",
            "--no-guess",
            "--no-overwrite-ignore",
            "--",
            branch,
        ],
    )?;
    Ok(())
}

fn discard_paths(root: &Path, paths: &[String]) -> Result<(), String> {
    let state = snapshot(root)?;
    let mut changes = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for path in paths {
        if !seen.insert(path) {
            continue;
        }
        let change = state
            .changes
            .iter()
            .find(|change| &change.path == path)
            .ok_or("This file has no changes to discard. Refresh and try again.")?;
        if Path::new(path)
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
            || state.submodules.iter().any(|module| module == path)
            || change.index == 'U'
            || change.worktree == 'U'
            || (change.index == 'A' && change.worktree == 'A')
            || (change.index == 'D' && change.worktree == 'D')
        {
            return Err("Resolve conflicts and submodule changes manually.".into());
        }
        changes.push(change);
    }
    for change in changes {
        let path = change.path.as_str();
        let in_head = git(root, &["ls-tree", "-z", "HEAD", "--", path])
            .map(|entry| !entry.is_empty())
            .unwrap_or(false);
        if in_head {
            git(
                root,
                &[
                    "restore",
                    "--source=HEAD",
                    "--staged",
                    "--worktree",
                    "--",
                    path,
                ],
            )?;
        } else if change.index != '?' && change.index != ' ' {
            // Restoring a parent file can already remove a staged child path.
            git(root, &["rm", "-f", "--ignore-unmatch", "--", path])?;
        } else {
            git(root, &["clean", "-f", "--", path])?;
        }
    }
    Ok(())
}

const IMAGE_PREVIEW_LIMIT: u64 = 12 * 1024 * 1024;

fn image_blob(root: &Path, revision: &str) -> Result<Option<String>, String> {
    let Ok(object) = git(root, &["rev-parse", "--verify", "--end-of-options", revision]) else {
        return Ok(None);
    };
    read_image_blob(root, object.trim())
}

fn read_image_blob(root: &Path, object: &str) -> Result<Option<String>, String> {
    validate_commit_hash(object)?;
    if object.bytes().all(|digit| digit == b'0') {
        return Ok(None);
    }
    let size = git(root, &["cat-file", "-s", object])?;
    let size: u64 = size.trim().parse().map_err(|_| "Could not read image size.")?;
    if size > IMAGE_PREVIEW_LIMIT {
        return Err("Images over 12 MB cannot be previewed.".into());
    }
    let blob = run(root, &["cat-file", "blob", object])?;
    if !blob.status.success() {
        return Ok(None);
    }
    Ok(Some(STANDARD.encode(blob.stdout)))
}

fn working_image(root: &Path, path: &Path) -> Result<Option<String>, String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let file = match root.join(path).canonicalize() {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !file.starts_with(&root) || !file.is_file() {
        return Err("Image preview requires a regular file inside the repository.".into());
    }
    let file = std::fs::File::open(file).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(IMAGE_PREVIEW_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > IMAGE_PREVIEW_LIMIT {
        return Err("Images over 12 MB cannot be previewed.".into());
    }
    Ok(Some(STANDARD.encode(bytes)))
}

fn image_preview(root: &Path, path: &str, staged: bool) -> Result<ImagePreview, String> {
    let relative = Path::new(path);
    if path.is_empty() || !relative.components().all(|part| matches!(part, std::path::Component::Normal(_))) {
        return Err("Invalid image path.".into());
    }
    let index = format!(":0:{path}");
    let (before, after) = if staged {
        (image_blob(root, &format!("HEAD:{path}"))?, image_blob(root, &index)?)
    } else {
        (image_blob(root, &index)?, working_image(root, relative)?)
    };
    Ok(ImagePreview { before, after })
}

fn file_diff(root: &Path, path: &str, staged: bool, untracked: bool) -> Result<String, String> {
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
    if untracked {
        args.extend(["--no-index", "--", "/dev/null", path]);
    } else {
        if staged {
            args.push("--cached");
        }
        args.extend(["--", path]);
    }
    output(run(root, &args)?, untracked)
}

fn apply_hunk(
    root: &Path,
    path: &str,
    staged: bool,
    expected_diff: &str,
    hunk: usize,
) -> Result<(), String> {
    let diff = file_diff(root, path, staged, false)?;
    if diff != expected_diff {
        return Err("This diff changed. Refresh the repository and try again.".into());
    }
    if diff.contains('\u{fffd}') {
        return Err("Partial staging requires a UTF-8 text diff.".into());
    }
    let (header, hunks) = diff
        .split_once("\n@@ ")
        .ok_or("This file has no selectable text changes.")?;
    let headers: Vec<_> = header.lines().collect();
    // Only alter file content. Applying mode, rename, or deletion headers
    // would stage changes outside the selected hunk.
    let [files, index, before, after] = headers.as_slice() else {
        return Err("Partial staging is available for modified text files.".into());
    };
    if !files.starts_with("diff --git ")
        || !index.starts_with("index ")
        || !matches!(index.split_whitespace().last(), Some("100644" | "100755"))
        || !(before.starts_with("--- a/") || before.starts_with("--- \"a/"))
        || !(after.starts_with("+++ b/") || after.starts_with("+++ \"b/"))
        || hunks.contains("\ndiff --git ")
    {
        return Err("Partial staging is available for modified text files.".into());
    }
    let selected = hunks
        .split("\n@@ ")
        .nth(hunk)
        .ok_or("This hunk is no longer available.")?;
    let patch = format!("{files}\n{before}\n{after}\n@@ {}\n", selected.trim_end_matches('\n'));

    let mut args = vec!["apply", "--cached", "--whitespace=nowarn"];
    if staged {
        args.push("--reverse");
    }
    args.push("-");
    git_with_input(root, &args, patch.as_bytes())
}

fn git_with_input(root: &Path, args: &[&str], input: &[u8]) -> Result<(), String> {
    let mut child = Command::new("/usr/bin/git")
        .current_dir(root)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start Git: {error}"))?;
    let write = child
        .stdin
        .take()
        .expect("piped Git stdin")
        .write_all(input);
    output(child.wait_with_output().map_err(|error| error.to_string())?, false)?;
    write.map_err(|error| error.to_string())
}

fn https_credential_url(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "The remote needs a valid HTTPS URL.")?;
    if url.scheme() != "https" || url.host().is_none() || !url.username().is_empty()
        || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
        || url.path() == "/"
    {
        return Err("Use an HTTPS repository URL without embedded credentials, query, or fragment.".into());
    }
    Ok(url)
}

fn save_https_credential(root: &Path, remote: &str, username: &str, token: &str) -> Result<(), String> {
    if [username, token].iter().any(|value| value.trim().is_empty() || value.contains(['\n', '\r', '\0'])) {
        return Err("Enter a username and token without line breaks.".into());
    }
    if !git(root, &["remote"])?.lines().any(|name| name == remote) {
        return Err("Select a configured remote.".into());
    }
    let target = git(root, &["remote", "get-url", "--push", "--", remote])?;
    let url = https_credential_url(target.trim_end())?;
    let input = format!("url={url}\nusername={username}\npassword={token}\n\n");
    git_with_input(
        root,
        &["-c", "credential.helper=", "-c", "credential.helper=osxkeychain",
          "-c", "credential.useHttpPath=true", "credential", "approve"],
        input.as_bytes(),
    ).map_err(|_| "Could not save credentials to macOS Keychain.".to_owned())?;

    let scope = format!("credential.{url}");
    git(root, &["config", "--local", &format!("{scope}.useHttpPath"), "true"])?;
    git(root, &["config", "--local", &format!("{scope}.username"), username])?;
    let helper = format!("{scope}.helper");
    git(root, &["config", "--local", "--replace-all", &helper, ""])?;
    git(root, &["config", "--local", "--add", &helper, "osxkeychain"])?;
    Ok(())
}

#[derive(Deserialize, Serialize, PartialEq)]
struct ForcePushPlan {
    branch: String,
    head: String,
    remote: String,
    destination: String,
    expected: String,
    removed: usize,
}

fn force_push_plan(root: &Path) -> Result<ForcePushPlan, String> {
    let branch = git(root, &["symbolic-ref", "--quiet", "HEAD"])?;
    let branch = branch.trim_end();
    let tracking = git(root, &[
        "for-each-ref", "--format=%(upstream:remotename)%09%(upstream:remoteref)%09%(upstream)",
        branch,
    ])?;
    let fields: Vec<_> = tracking.trim_end_matches('\n').split('\t').collect();
    let [remote, destination, upstream] = fields.as_slice() else {
        return Err("The branch needs a remote upstream. Fetch and try again.".into());
    };
    if !destination.starts_with("refs/heads/") || !upstream.starts_with("refs/remotes/") {
        return Err("The branch needs a remote upstream. Fetch and try again.".into());
    }
    let push_urls = git(root, &["remote", "get-url", "--push", "--all", "--", remote])?;
    if push_urls.lines().count() != 1 {
        return Err("Force push requires a remote with exactly one push URL.".into());
    }
    let head = git(root, &["rev-parse", "--verify", "HEAD"])?;
    let expected = git(root, &["rev-parse", "--verify", upstream])?;
    let range = format!("{}..{}", head.trim_end(), expected.trim_end());
    let removed = git(root, &["rev-list", "--count", &range])?
        .trim().parse().map_err(|_| "Could not count remote commits.")?;
    Ok(ForcePushPlan {
        branch: branch.trim_start_matches("refs/heads/").into(),
        head: head.trim_end().into(), remote: (*remote).into(), destination: (*destination).into(),
        expected: expected.trim_end().into(), removed,
    })
}

#[derive(Serialize)]
struct RebasePreview {
    upstream: String,
    upstream_ref: String,
    commits: Vec<String>,
}

fn rebase_preview(root: &Path) -> Result<RebasePreview, String> {
    let upstream = git(root, &["rev-parse", "--verify", "@{upstream}^{commit}"])?;
    let upstream = upstream.trim_end().to_owned();
    let upstream_ref = git(root, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])?;
    let range = format!("{upstream}..HEAD");
    let commits = git(root, &["rev-list", "--reverse", "--topo-order", &range, "--"])?
        .lines().map(str::to_owned).collect();
    Ok(RebasePreview { upstream, upstream_ref: upstream_ref.trim_end().into(), commits })
}

fn check_soft_reset(root: &Path, hash: &str, branch: &str, head: &str) -> Result<(), String> {
    validate_commit_hash(hash)?;
    let current_branch = git(root, &["symbolic-ref", "--quiet", "HEAD"])
        .map_err(|_| "Check out a branch before resetting.")?;
    let current_head = git(root, &["rev-parse", "--verify", "HEAD"])?;
    if current_branch.trim_end().strip_prefix("refs/heads/") != Some(branch)
        || current_head.trim_end() != head
    {
        return Err("The current branch or HEAD changed. Refresh and try again.".into());
    }
    let ancestry = run(root, &["merge-base", "--is-ancestor", hash, head])?;
    if hash == head || ancestry.status.code() == Some(1) {
        return Err("Soft reset requires an earlier commit in the current branch’s history.".into());
    }
    output(ancestry, false)?;
    Ok(())
}

fn perform(root: Option<String>, action: Action) -> Result<Response, String> {
    let action = match action {
        Action::Open { folder } => return snapshot(Path::new(&folder)).map(Response::Snapshot),
        Action::Clone { url, parent, name } => {
            let ssh_scp = url.split_once(':').is_some_and(|(host, path)| {
                host.contains('@') && !host.contains('/') && !path.is_empty()
            });
            if !(url.starts_with("https://") || url.starts_with("ssh://") || ssh_scp)
                || url.chars().any(char::is_whitespace)
            {
                return Err("Enter an HTTPS or SSH repository URL.".into());
            }
            if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
                return Err("Enter a single folder name.".into());
            }
            let parent = Path::new(&parent);
            let destination = parent.join(&name);
            if destination.symlink_metadata().is_ok() {
                return Err("A file or folder with that name already exists.".into());
            }
            git(
                parent,
                &[
                    "-c",
                    "protocol.allow=never",
                    "-c",
                    "protocol.https.allow=always",
                    "-c",
                    "protocol.ssh.allow=always",
                    "clone",
                    "--",
                    &url,
                    &name,
                ],
            )?;
            return snapshot(&destination).map(Response::Snapshot);
        }
        action => action,
    };
    let root = root.as_deref().ok_or("Open a repository first.")?;
    let root = Path::new(root);
    match action {
        Action::Open { .. } | Action::Clone { .. } => unreachable!(),
        Action::RefreshIfChanged { repo_version: expected } => {
            let branch = git(root, &["symbolic-ref", "--quiet", "HEAD"]).ok();
            let changes = working_changes(root)?;
            if repo_version(root, branch.as_deref(), &changes)? == expected {
                Ok(Response::Unchanged(()))
            } else {
                snapshot(root).map(Response::Snapshot)
            }
        }
        Action::CommitMessageContext => commit_message::context(root).map(Response::CommitMessageContext),
        Action::CheckCommitMessageIndex { tree, head, branch } => {
            commit_message::check_context(root, &tree, head.as_deref(), &branch)?;
            Ok(Response::Unchanged(()))
        }
        Action::CheckSoftReset { hash, branch, head } => {
            check_soft_reset(root, &hash, &branch, &head)?;
            Ok(Response::Unchanged(()))
        }
        Action::RebasePreview => rebase_preview(root).map(Response::RebasePreview),
        Action::ForcePushPlan => force_push_plan(root).map(Response::ForcePushPlan),
        Action::Diff {
            path,
            staged,
            untracked,
        } => {
            file_diff(root, &path, staged, untracked).map(Response::Text)
        }
        Action::ImagePreview { path, staged } => {
            image_preview(root, &path, staged).map(Response::ImagePreview)
        }
        Action::CommitImagePreview { before, after } => {
            Ok(Response::ImagePreview(ImagePreview {
                before: read_image_blob(root, &before)?,
                after: read_image_blob(root, &after)?,
            }))
        }
        Action::OlderHistory {
            hash,
            offset,
            anchor,
        } => {
            let mut page = match hash.as_deref() {
                Some(hash) => {
                    validate_commit_hash(hash)?;
                    history(root, &[hash], &Default::default(), &local_branches(root)?.0, offset.saturating_sub(1), 101)?
                }
                None => {
                    let (branches, incoming) = local_branches(root)?;
                    branch_history(root, &branches, &incoming, offset.saturating_sub(1), 101)?
                }
            };
            if page.first().map(|commit| commit.hash.as_str()) != Some(&anchor) {
                return Err("History changed. Refresh the repository and try again.".into());
            }
            page.remove(0);
            Ok(Response::History(page))
        }
        Action::History { hash } => {
            validate_commit_hash(&hash)?;
            history(root, &[&hash], &Default::default(), &local_branches(root)?.0, 0, 100).map(Response::History)
        }
        Action::Show { hash } => {
            validate_commit_hash(&hash)?;
            git(
                root,
                &[
                    "show",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-color",
                    "--full-index",
                    "--format=fuller",
                    &hash,
                    "--",
                ],
            )
            .map(Response::Text)
        }
        action => {
            match action {
                Action::ResolveConflict { path, resolution } => {
                    let entries = git(root, &["ls-files", "--unmerged", "-z", "--", &path])?;
                    let stages: Vec<_> = entries
                        .split('\0')
                        .filter_map(|entry| {
                            let (metadata, name) = entry.split_once('\t')?;
                            (name == path).then_some(metadata)
                        })
                        .collect();
                    if stages.is_empty() {
                        return Err("This file no longer has a conflict.".into());
                    }
                    if stages.iter().any(|entry| entry.starts_with("160000 ")) {
                        return Err("Resolve submodule conflicts manually.".into());
                    }
                    let side = match resolution {
                        ConflictResolution::Current => Some(("--ours", " 2")),
                        ConflictResolution::Incoming => Some(("--theirs", " 3")),
                        ConflictResolution::MarkResolved => None,
                    };
                    if let Some((flag, stage)) = side {
                        if stages.iter().any(|entry| entry.ends_with(stage)) {
                            git(root, &["restore", "--worktree", flag, "--", &path])?;
                        } else {
                            git(root, &["rm", "-f", "--", &path])?;
                            return snapshot(root).map(Response::Snapshot);
                        }
                    }
                    git(root, &["add", "--", &path])?;
                }
                Action::ApplyHunk {
                    path,
                    staged,
                    expected_diff,
                    hunk,
                } => {
                    apply_hunk(root, &path, staged, &expected_diff, hunk)?;
                }
                bulk @ (Action::StageAll | Action::UnstageAll) => {
                    let unstage = matches!(bulk, Action::UnstageAll);
                    let mut paths = Vec::new();
                    for change in working_changes(root)? {
                        let conflict = change.index == 'U' || change.worktree == 'U'
                            || matches!((change.index, change.worktree), ('A', 'A') | ('D', 'D'));
                        let included = if unstage {
                            !matches!(change.index, ' ' | '?')
                        } else {
                            change.worktree != ' '
                        };
                        if !conflict && included {
                            paths.extend_from_slice(change.path.as_bytes());
                            paths.push(0);
                        }
                    }
                    if !paths.is_empty() {
                        let mut args = vec!["--literal-pathspecs"];
                        if !unstage {
                            args.push("add");
                        } else if run(root, &["rev-parse", "--verify", "HEAD"])?.status.success() {
                            args.extend(["restore", "--staged"]);
                        } else {
                            args.extend(["rm", "--cached", "-f"]);
                        }
                        args.extend(["--pathspec-from-file=-", "--pathspec-file-nul"]);
                        git_with_input(root, &args, &paths)?;
                    }
                }
                Action::Stage { path } => {
                    git(root, &["add", "--", &path])?;
                }
                Action::Unstage { path } => {
                    if run(root, &["rev-parse", "--verify", "HEAD"])?
                        .status
                        .success()
                    {
                        git(root, &["restore", "--staged", "--", &path])?;
                    } else {
                        git(root, &["rm", "--cached", "-f", "--", &path])?;
                    }
                }
                Action::Discard { path } => discard_paths(root, &[path])?,
                Action::DiscardMany { paths } => discard_paths(root, &paths)?,
                Action::Commit { message } => {
                    if message.trim().is_empty() {
                        return Err("Enter a commit message.".into());
                    }
                    git(root, &["commit", "-m", &message])?;
                }
                Action::Fetch => {
                    git(root, &["fetch", "--all"])?;
                }
                Action::Pull => {
                    git(root, &["pull", "--ff-only"])?;
                }
                Action::SaveHttpsCredential { remote, username, token } => {
                    save_https_credential(root, &remote, &username, &token)?;
                }
                Action::SetOrigin { url } => {
                    let url = url.trim();
                    if url.is_empty() || url.starts_with('-') || url.chars().any(char::is_control) {
                        return Err("Enter a valid origin URL or repository path.".into());
                    }
                    let exists = git(root, &["remote"])?.lines().any(|name| name == "origin");
                    if exists {
                        git(root, &["remote", "set-url", "origin", url])?;
                    } else {
                        git(root, &["remote", "add", "origin", url])?;
                    }
                }
                Action::ForcePush { plan } => {
                    if force_push_plan(root)? != plan || plan.removed == 0 {
                        return Err("The branch or its upstream changed. Review the force push again.".into());
                    }
                    let lease = format!("--force-with-lease={}:{}", plan.destination, plan.expected);
                    let refspec = format!("{}:{}", plan.head, plan.destination);
                    git(root, &["push", &lease, "--", &plan.remote, &refspec])?;
                }
                Action::Push => {
                    git(root, &["push"])?;
                }
                Action::PublishBranch { branch, remote } => {
                    let reference = format!("refs/heads/{branch}");
                    let current = git(root, &["symbolic-ref", "--quiet", "HEAD"])?;
                    if current.trim_end() != reference || has_upstream(root, &branch)? {
                        return Err("The current branch or its upstream changed. Refresh and try again.".into());
                    }
                    if !git(root, &["remote"])?.lines().any(|name| name == remote) {
                        return Err("Select a configured remote.".into());
                    }
                    let refspec = format!("{reference}:{reference}");
                    git(root, &["push", "--set-upstream", "--", &remote, &refspec])?;
                }
                Action::Branch { name, start } => {
                    let mut args = vec!["branch", "--", &name];
                    if let Some(hash) = start.as_deref() {
                        validate_commit_hash(hash)?;
                        args.push(hash);
                    }
                    git(root, &args)?;
                }
                Action::CheckoutCommit { hash } => {
                    validate_commit_hash(&hash)?;
                    git(
                        root,
                        &["switch", "--detach", "--no-overwrite-ignore", "--", &hash],
                    )?;
                }
                Action::Tag { name, hash } => {
                    validate_commit_hash(&hash)?;
                    git(root, &["tag", "--no-sign", "--", &name, &hash])?;
                }
                Action::DeleteTag { name } => {
                    git(root, &["tag", "--delete", "--", &name])?;
                }
                Action::RenameBranch { branch, name } => {
                    git(root, &["check-ref-format", &format!("refs/heads/{branch}")])?;
                    git(root, &["branch", "--move", "--", &branch, &name])?;
                }
                Action::DeleteBranch { branch } => {
                    git(root, &["branch", "--delete", "--", &branch])?;
                }
                Action::CheckoutBranch { branch } => checkout_branch(root, &branch)?,
                Action::CheckoutRemote { remote, branch } => {
                    if !git(root, &["remote"])?.lines().any(|name| name == remote) {
                        return Err("Remote no longer exists.".into());
                    }
                    let reference = format!("refs/remotes/{remote}/{branch}");
                    git(root, &["check-ref-format", &reference])?;
                    git(root, &["show-ref", "--verify", &reference])?;
                    if run(root, &["symbolic-ref", "--quiet", &reference])?
                        .status
                        .success()
                    {
                        return Err("Select a remote branch.".into());
                    }
                    let local = format!("refs/heads/{branch}");
                    git(root, &["check-ref-format", &local])?;
                    if run(root, &["show-ref", "--verify", "--quiet", &local])?
                        .status
                        .success()
                    {
                        checkout_branch(root, &branch)?;
                    } else {
                        git(
                            root,
                            &[
                                "switch",
                                "--no-overwrite-ignore",
                                "--track",
                                "-c",
                                &branch,
                                "--",
                                &reference,
                            ],
                        )?;
                    }
                }
                Action::Merge { branch } => {
                    let reference = format!("refs/heads/{branch}");
                    git(root, &["show-ref", "--verify", &reference])?;
                    git(root, &["merge", "--no-edit", "--", &reference])?;
                }
                Action::Stash { message } => {
                    let mut args = vec!["stash", "push", "--include-untracked"];
                    if !message.trim().is_empty() {
                        args.extend(["-m", &message]);
                    }
                    git(root, &args)?;
                }
                Action::CherryPick {
                    hash,
                    mainline,
                    no_commit,
                } => {
                    if !matches!(hash.len(), 40 | 64)
                        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
                    {
                        return Err("Invalid commit hash.".into());
                    }
                    let parent = mainline.map(|parent| parent.to_string());
                    let mut args = vec!["cherry-pick"];
                    if no_commit {
                        args.push("--no-commit");
                    }
                    if let Some(parent) = parent.as_deref() {
                        args.extend(["--mainline", parent]);
                    }
                    args.extend(["--", &hash]);
                    git(root, &args)?;
                }
                Action::ResetSoft { hash, branch, head } => {
                    check_soft_reset(root, &hash, &branch, &head)?;
                    git(root, &["reset", "--soft", &hash, "--"])?;
                }
                Action::RebaseUpstream { branch, head, upstream } => {
                    let current = git(root, &["symbolic-ref", "--quiet", "HEAD"])?;
                    let tip = git(root, &["rev-parse", "--verify", "HEAD"])?;
                    if current.trim_end().strip_prefix("refs/heads/") != Some(&branch)
                        || tip.trim_end() != head
                    {
                        return Err("The branch changed. Review the rebase again.".into());
                    }
                    if git(root, &["rev-parse", "--verify", "@{upstream}^{commit}"])?.trim_end() != upstream {
                        return Err("The upstream changed. Review the rebase again.".into());
                    }
                    if !working_changes(root)?.is_empty() {
                        return Err("Commit or stash your changes before rebasing.".into());
                    }
                    git(root, &["rebase", "--no-autostash", "--no-update-refs", "--rebase-merges", &upstream])?;
                }
                Action::ContinueRebase => {
                    if !rebase_in_progress(root)? {
                        return Err("No rebase is in progress.".into());
                    }
                    git(root, &["rebase", "--continue"])?;
                }
                Action::AbortRebase => {
                    if !rebase_in_progress(root)? {
                        return Err("No rebase is in progress.".into());
                    }
                    git(root, &["rebase", "--abort"])?;
                }
                Action::ContinueCherryPick => {
                    git(root, &["cherry-pick", "--continue"])?;
                }
                Action::AbortCherryPick => {
                    git(root, &["cherry-pick", "--abort"])?;
                }
                _ => unreachable!(),
            }
            snapshot(root).map(Response::Snapshot)
        }
    }
}

#[tauri::command]
async fn repository(root: Option<String>, action: Action) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || perform(root, action))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn git_available() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // Avoid invoking Apple's Git shim before the developer tools are installed.
        let developer_dir = Command::new("/usr/bin/xcode-select").arg("-p").output()?;
        if !developer_dir.status.success() {
            return Ok(false);
        }
        let git = Command::new("/usr/bin/git").arg("--version").output()?;
        Ok(git.status.success())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error: std::io::Error| error.to_string())
}

#[tauri::command]
async fn install_command_line_tools() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let result = Command::new("/usr/bin/xcode-select")
            .arg("--install")
            .output()
            .map_err(|error| error.to_string())?;
        output(result, false).map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            repository,
            git_available,
            install_command_line_tools,
            updates::check_for_updates,
            updates::open_release_page,
            updates::open_related_project,
            updates::open_token_setup
        ])
        .run(tauri::generate_context!())
        .expect("Natalie could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) struct TestRepository(pub(crate) std::path::PathBuf);
    impl Drop for TestRepository {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    pub(crate) fn test_repository() -> TestRepository {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT_REPOSITORY: AtomicUsize = AtomicUsize::new(0);
        let folder = std::env::temp_dir().join(format!(
            "natalie-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_REPOSITORY.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir(&folder).unwrap();
        let repository = TestRepository(folder);
        let folder = &repository.0;
        git(folder, &["init", "-b", "main"]).unwrap();
        git(folder, &["config", "user.name", "Natalie Test"]).unwrap();
        git(folder, &["config", "user.email", "test@example.invalid"]).unwrap();
        git(folder, &["config", "commit.gpgsign", "false"]).unwrap();
        git(folder, &["config", "core.hooksPath", "/dev/null"]).unwrap();
        repository
    }

    #[test]
    fn rebase_upstream_can_abort_or_continue_after_a_conflict() {
        let repository = test_repository();
        let folder = &repository.0;
        let file = folder.join("conflict.txt");
        let commit = |content: &str| {
            std::fs::write(&file, content).unwrap();
            git(folder, &["add", "--", "conflict.txt"]).unwrap();
            git(folder, &["commit", "-m", content]).unwrap();
        };
        commit("base");
        git(folder, &["branch", "upstream"]).unwrap();
        commit("local");
        let local = git(folder, &["rev-parse", "HEAD"]).unwrap().trim().to_owned();
        git(folder, &["switch", "upstream"]).unwrap();
        commit("remote");
        git(folder, &["switch", "main"]).unwrap();
        git(folder, &["branch", "--set-upstream-to=upstream"]).unwrap();
        let root = Some(folder.to_string_lossy().into_owned());
        let upstream = rebase_preview(folder).unwrap().upstream;
        let start = || perform(root.clone(), Action::RebaseUpstream {
            branch: "main".into(), head: local.clone(), upstream: upstream.clone(),
        });
        assert!(start().is_err());
        assert!(snapshot(folder).unwrap().rebasing);
        perform(root.clone(), Action::AbortRebase).unwrap();
        assert_eq!(snapshot(folder).unwrap().head.as_deref(), Some(local.as_str()));
        assert!(start().is_err());
        std::fs::write(&file, "resolved").unwrap();
        git(folder, &["add", "--", "conflict.txt"]).unwrap();
        let Response::Snapshot(rebased) = perform(root, Action::ContinueRebase).unwrap() else {
            panic!("Expected rebased repository");
        };
        assert!(!rebased.rebasing);
        assert_eq!(rebased.ahead, Some(1));
        assert_eq!(rebased.behind, Some(0));
    }

    #[test]
    fn force_push_rejects_remote_changes_until_a_new_lease_is_reviewed() {
        let upstream = test_repository();
        let local = test_repository();
        let remote = &upstream.0;
        let folder = &local.0;
        git(remote, &["config", "receive.denyCurrentBranch", "ignore"]).unwrap();
        git(remote, &["commit", "--allow-empty", "-m", "Base"]).unwrap();
        git(remote, &["commit", "--allow-empty", "-m", "Remote tip"]).unwrap();
        git(folder, &["remote", "add", "origin", remote.to_str().unwrap()]).unwrap();
        git(folder, &["fetch", "origin"]).unwrap();
        git(folder, &["checkout", "-B", "main", "--track", "origin/main"]).unwrap();
        git(folder, &["reset", "--soft", "HEAD^"]).unwrap();

        let stale = force_push_plan(folder).unwrap();
        assert_eq!(stale.removed, 1);
        git(remote, &["commit", "--allow-empty", "-m", "New remote commit"]).unwrap();
        let root = Some(folder.to_string_lossy().into_owned());
        let error = perform(root.clone(), Action::ForcePush { plan: stale }).err().unwrap();
        assert!(error.contains("stale info"), "{error}");

        git(folder, &["fetch", "origin"]).unwrap();
        let plan = force_push_plan(folder).unwrap();
        assert_eq!(plan.removed, 2);
        perform(root, Action::ForcePush { plan }).unwrap();
        assert_eq!(
            git(folder, &["rev-parse", "HEAD"]).unwrap(),
            git(remote, &["rev-parse", "HEAD"]).unwrap(),
        );
    }

    #[test]
    fn discard_all_after_soft_reset_restores_file_replaced_by_directory() {
        let repository = test_repository();
        let folder = &repository.0;
        let path = folder.join("item");
        std::fs::write(&path, "original file").unwrap();
        git(folder, &["add", "--", "item"]).unwrap();
        git(folder, &["commit", "-m", "Add file"]).unwrap();
        let before = snapshot(folder).unwrap();

        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("child"), "replacement").unwrap();
        git(folder, &["add", "-A"]).unwrap();
        git(folder, &["commit", "-m", "Replace file with directory"]).unwrap();
        let committed = snapshot(folder).unwrap();

        let Response::Snapshot(reset) = perform(
            Some(committed.root.clone()),
            Action::ResetSoft {
                hash: before.head.unwrap(),
                branch: committed.branch,
                head: committed.head.unwrap(),
            },
        ).unwrap() else {
            panic!("Expected soft-reset snapshot");
        };
        let forward = git(folder, &["rev-parse", "ORIG_HEAD"]).unwrap();
        assert!(check_soft_reset(
            folder, forward.trim(), &reset.branch, reset.head.as_deref().unwrap(),
        ).is_err());
        let paths = reset.changes.into_iter().map(|change| change.path).collect();
        let Response::Snapshot(discarded) =
            perform(Some(reset.root), Action::DiscardMany { paths }).unwrap()
        else {
            panic!("Expected discard snapshot");
        };
        assert!(discarded.changes.is_empty());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "original file");
    }

    #[test]
    fn credential_urls_are_https_and_repository_scoped() {
        for url in [
            "https://github.com/owner/repo.git",
            "https://gitlab.example.com:8443/group/project.git",
            "https://dev.azure.com/org/project/_git/repo",
        ] {
            assert!(https_credential_url(url).is_ok());
        }
        for url in [
            "http://example.com/repo.git",
            "git@example.com:repo.git",
            "https://example.com/",
            "https://name:secret@example.com/repo.git",
            "https://example.com/repo.git?query",
        ] {
            assert!(https_credential_url(url).is_err());
        }
    }

    #[test]
    fn refresh_detects_external_edits_staging_commits_and_branch_switches() {
        let repository = test_repository();
        let folder = &repository.0;
        let original = snapshot(folder).unwrap();
        let refresh = |previous: &Snapshot| {
            perform(
                Some(previous.root.clone()),
                Action::RefreshIfChanged { repo_version: previous.repo_version.clone() },
            )
            .unwrap()
        };
        assert!(matches!(refresh(&original), Response::Unchanged(())));
        std::fs::write(folder.join("external.txt"), "external edit").unwrap();
        let Response::Snapshot(edited) = refresh(&original) else {
            panic!("Expected File Status refresh after creating a file");
        };
        assert_eq!(edited.changes[0].path, "external.txt");
        assert_eq!(edited.changes[0].index, '?');

        git(folder, &["add", "--", "external.txt"]).unwrap();
        let Response::Snapshot(staged) = refresh(&edited) else {
            panic!("Expected File Status refresh after staging");
        };
        assert_eq!(staged.changes[0].index, 'A');

        git(folder, &["commit", "-m", "External commit"]).unwrap();
        let Response::Snapshot(committed) = refresh(&staged) else {
            panic!("Expected new history after an external commit");
        };
        assert_eq!(committed.commits[0].subject, "External commit");
        assert!(committed.changes.is_empty());
        assert!(matches!(refresh(&committed), Response::Unchanged(())));

        git(folder, &["branch", "other"]).unwrap();
        let before_switch = snapshot(folder).unwrap();
        git(folder, &["switch", "other"]).unwrap();
        let Response::Snapshot(switched) = refresh(&before_switch) else {
            panic!("Expected refresh after an external branch switch");
        };
        assert_eq!(switched.branch, "other");
        assert_eq!(switched.head, before_switch.head);
    }

    #[test]
    fn previews_image_versions_from_head_index_and_worktree() {
        let repository = test_repository();
        let folder = &repository.0;
        let path = "image with spaces.png";
        let file = folder.join(path);
        std::fs::write(&file, b"original").unwrap();
        let added = image_preview(folder, path, false).unwrap();
        assert_eq!(added.before, None);
        assert_eq!(added.after, Some(STANDARD.encode(b"original")));

        git(folder, &["add", "--", path]).unwrap();
        git(folder, &["commit", "-m", "Add image"]).unwrap();
        std::fs::write(&file, b"staged").unwrap();
        git(folder, &["add", "--", path]).unwrap();
        std::fs::write(&file, b"working").unwrap();

        let staged = image_preview(folder, path, true).unwrap();
        assert_eq!(staged.before, Some(STANDARD.encode(b"original")));
        assert_eq!(staged.after, Some(STANDARD.encode(b"staged")));
        let working = image_preview(folder, path, false).unwrap();
        assert_eq!(working.before, staged.after);
        assert_eq!(working.after, Some(STANDARD.encode(b"working")));

        let blob = git(folder, &["rev-parse", "HEAD:image with spaces.png"]).unwrap();
        let response = perform(
            Some(folder.to_string_lossy().into_owned()),
            Action::CommitImagePreview {
                before: "0".repeat(blob.trim().len()),
                after: blob.trim().to_owned(),
            },
        )
        .unwrap();
        let Response::ImagePreview(committed) = response else {
            panic!("Expected image preview");
        };
        assert_eq!(committed.before, None);
        assert_eq!(committed.after, staged.before);

        std::fs::remove_file(file).unwrap();
        assert_eq!(image_preview(folder, path, false).unwrap().after, None);
        assert!(image_preview(folder, "../outside.png", false).is_err());
    }

    #[test]
    fn graph_includes_five_recent_untracked_origin_branches_and_pages_consistently() {
        let remote = test_repository();
        let local = test_repository();
        let path = &local.0;
        git(&remote.0, &["commit", "--allow-empty", "-m", "Shared base"]).unwrap();
        let base = git(&remote.0, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_owned();
        for number in 1..=9 {
            let branch = format!("topic/{number}");
            git(&remote.0, &["checkout", "-B", &branch, &base]).unwrap();
            let date = format!("2026-11-01T{number:02}:00:00+00:00");
            let status = Command::new("/usr/bin/git")
                .current_dir(&remote.0)
                .env("GIT_AUTHOR_DATE", &date)
                .env("GIT_COMMITTER_DATE", &date)
                .args(["commit", "--allow-empty", "-m", &branch])
                .output()
                .unwrap();
            assert!(status.status.success());
        }
        git(
            path,
            &["remote", "add", "origin", remote.0.to_str().unwrap()],
        )
        .unwrap();
        git(path, &["fetch", "origin"]).unwrap();
        git(path, &["checkout", "-B", "main", "--track", "origin/main"]).unwrap();
        git(path, &["branch", "--no-track", "topic/9", "origin/topic/9"]).unwrap();
        git(
            path,
            &[
                "branch",
                "--track",
                "different-local-name",
                "origin/topic/8",
            ],
        )
        .unwrap();
        git(
            path,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/topic/7",
            ],
        )
        .unwrap();
        git(
            path,
            &[
                "update-ref",
                "refs/remotes/other/extra",
                "refs/remotes/origin/topic/9",
            ],
        )
        .unwrap();
        git(path, &["commit", "--allow-empty", "-m", "Local work"]).unwrap();
        let before = snapshot(path).unwrap();
        let names: Vec<_> = before
            .recent_origin_branches
            .iter()
            .map(|branch| branch.reference.name.as_str())
            .collect();
        assert_eq!(
            names,
            [
                "origin/topic/7",
                "origin/topic/6",
                "origin/topic/5",
                "origin/topic/4",
                "origin/topic/3"
            ]
        );
        assert!(before
            .recent_origin_branches
            .iter()
            .all(|branch| branch.author == "Natalie Test" && branch.date.starts_with("2026-11-01")));
        for branch in &before.recent_origin_branches {
            assert!(before
                .commits
                .iter()
                .any(|commit| commit.hash == branch.reference.hash));
        }
        assert!(before
            .commits
            .iter()
            .any(|commit| commit.subject == "Local work"));
        assert!(!before
            .commits
            .iter()
            .any(|commit| commit.subject == "topic/1" || commit.subject == "topic/2"));
        for branch in &before.recent_origin_branches {
            let commit = before
                .commits
                .iter()
                .find(|commit| commit.hash == branch.reference.hash)
                .unwrap();
            assert!(commit.origin_only);
            assert!(!commit.local_only && !commit.incoming);
        }
        assert!(before
            .commits
            .iter()
            .filter(|commit| ["Local work", "Shared base", "topic/8", "topic/9"]
                .contains(&commit.subject.as_str()))
            .all(|commit| !commit.origin_only));
        let (branches, incoming) = local_branches(path).unwrap();
        let paged = branch_history(path, &branches, &incoming, 1, 2).unwrap();
        assert_eq!(
            paged.iter().map(|commit| &commit.hash).collect::<Vec<_>>(),
            before.commits[1..3]
                .iter()
                .map(|commit| &commit.hash)
                .collect::<Vec<_>>()
        );
        git(&remote.0, &["checkout", "-B", "brand-new", &base]).unwrap();
        let status = Command::new("/usr/bin/git")
            .current_dir(&remote.0)
            .env("GIT_AUTHOR_DATE", "2026-11-02T00:00:00+00:00")
            .env("GIT_COMMITTER_DATE", "2026-11-02T00:00:00+00:00")
            .args(["commit", "--allow-empty", "-m", "New remote branch"])
            .output()
            .unwrap();
        assert!(status.status.success());
        assert!(!snapshot(path)
            .unwrap()
            .remote_branches
            .iter()
            .any(|branch| branch.name == "origin/brand-new"));
        git(path, &["fetch", "origin"]).unwrap();
        let after = snapshot(path).unwrap();
        assert_eq!(
            after.recent_origin_branches[0].reference.name,
            "origin/brand-new"
        );
        assert!(after
            .commits
            .iter()
            .any(|commit| commit.subject == "New remote branch"));
        assert_eq!(after.branch, "main");
        assert!(!after
            .branches
            .iter()
            .any(|branch| branch.reference.name == "brand-new"));
        let older_remote_hash = git(path, &["rev-parse", "origin/topic/1"]).unwrap();
        let remote_history = history(
            path,
            &[older_remote_hash.trim()],
            &Default::default(),
            &local_branches(path).unwrap().0,
            0,
            100,
        )
        .unwrap();
        assert!(remote_history[0].origin_only);
        git(
            path,
            &["branch", "--track", "review-topic-seven", "origin/topic/7"],
        )
        .unwrap();
        let tracked = snapshot(path).unwrap();
        assert!(
            !tracked
                .commits
                .iter()
                .find(|commit| commit.subject == "topic/7")
                .unwrap()
                .origin_only
        );
        let unborn = test_repository();
        git(
            &unborn.0,
            &["remote", "add", "origin", remote.0.to_str().unwrap()],
        )
        .unwrap();
        git(&unborn.0, &["fetch", "origin"]).unwrap();
        let fetched_without_checkout = snapshot(&unborn.0).unwrap();
        assert!(fetched_without_checkout.head.is_none());
        assert_eq!(fetched_without_checkout.recent_origin_branches.len(), 5);
        assert!(fetched_without_checkout
            .commits
            .iter()
            .any(|commit| commit.subject == "New remote branch"));
        git(path, &["remote", "remove", "origin"]).unwrap();
        assert!(snapshot(path).unwrap().recent_origin_branches.is_empty());
    }

    #[test]
    fn previews_fetched_upstream_commits_until_pulled() {
        let remote = test_repository();
        let local = test_repository();
        let folder = &local.0;
        let remote_path = remote.0.to_str().unwrap();
        let commit = |path: &Path, subject| {
            git(path, &["commit", "--allow-empty", "-m", subject]).unwrap();
        };

        commit(&remote.0, "Shared base");
        git(folder, &["remote", "add", "origin", remote_path]).unwrap();
        git(folder, &["fetch", "origin"]).unwrap();
        git(folder, &["checkout", "-B", "main", "--track", "origin/main"]).unwrap();
        commit(&remote.0, "First incoming");
        git(folder, &["fetch", "origin"]).unwrap();
        commit(&remote.0, "Second incoming");
        commit(&remote.0, "Third incoming");
        assert_eq!(snapshot(folder).unwrap().behind, Some(1));

        let Response::Snapshot(preview) = perform(
            Some(folder.to_string_lossy().into_owned()),
            Action::Fetch,
        ).unwrap() else {
            panic!("Expected repository snapshot");
        };
        assert_eq!(preview.behind, Some(3));
        assert_eq!(preview.commits.iter().filter(|commit| commit.incoming_for_pull).count(), 3);
        assert_eq!(
            preview.head.as_deref(),
            Some(preview.commits[3].hash.as_str())
        );
        assert_eq!(
            preview
                .commits
                .iter()
                .map(|commit| (commit.subject.as_str(), commit.incoming))
                .collect::<Vec<_>>(),
            [
                ("Third incoming", true),
                ("Second incoming", true),
                ("First incoming", true),
                ("Shared base", false),
            ]
        );
        let (branches, incoming) = local_branches(folder).unwrap();
        assert!(branch_history(folder, &branches, &incoming, 1, 1).unwrap()[0].incoming);

        git(folder, &["branch", "--track", "ahead", "origin/main"]).unwrap();
        git(folder, &["checkout", "ahead"]).unwrap();
        commit(folder, "Local change");
        git(folder, &["checkout", "-b", "other", "--no-track"]).unwrap();
        let other = snapshot(folder).unwrap();
        assert_eq!(other.behind, None);
        assert!(other.commits.iter().all(|commit| !commit.incoming_for_pull));
        assert_eq!(
            other.branches.iter().map(|branch| (
                branch.reference.name.as_str(), branch.ahead, branch.behind
            )).collect::<Vec<_>>(),
            [("ahead", Some(1), Some(0)), ("main", Some(0), Some(3)), ("other", None, None)]
        );
        assert_eq!(
            other.commits.iter().filter(|commit| commit.incoming).count(),
            3
        );
        git(folder, &["checkout", "main"]).unwrap();
        git(folder, &["pull", "--ff-only"]).unwrap();
        let pulled = snapshot(folder).unwrap();
        assert_eq!(pulled.behind, Some(0));
        assert!(pulled.commits.iter().all(|commit| !commit.incoming));
    }

    #[test]
    fn stages_and_unstages_all_without_touching_conflicts() {
        let repository = test_repository();
        let folder = &repository.0;
        let root = Some(folder.to_str().unwrap().into());
        for file in ["modified.txt", "removed.txt"] {
            std::fs::write(folder.join(file), "base").unwrap();
        }
        git(folder, &["add", "--all"]).unwrap();
        git(folder, &["commit", "-m", "Base"]).unwrap();
        std::fs::write(folder.join("modified.txt"), "new content").unwrap();
        std::fs::remove_file(folder.join("removed.txt")).unwrap();
        std::fs::write(folder.join("new [literal].txt"), "new file").unwrap();

        let blob = git(folder, &["rev-parse", "HEAD:modified.txt"]).unwrap();
        let blob = blob.trim();
        let unmerged = format!("100644 {blob} 2\tconflict.txt\n100644 {blob} 3\tconflict.txt\n");
        git_with_input(folder, &["update-index", "--index-info"], unmerged.as_bytes()).unwrap();
        std::fs::write(folder.join("conflict.txt"), "unresolved").unwrap();

        let Response::Snapshot(next) = perform(root.clone(), Action::StageAll).unwrap() else {
            panic!("Expected repository snapshot");
        };
        let conflict = next.changes.iter().find(|change| change.path == "conflict.txt").unwrap();
        assert_eq!((conflict.index, conflict.worktree), ('A', 'A'));
        let staged: Vec<_> = next.changes.iter().filter(|change| change.worktree == ' ').collect();
        assert_eq!(staged.iter().map(|change| change.index).collect::<String>(), "MAD");
        perform(root.clone(), Action::StageAll).unwrap();
        let Response::Snapshot(next) = perform(root.clone(), Action::UnstageAll).unwrap() else {
            panic!("Expected repository snapshot");
        };
        let conflict = next.changes.iter().find(|change| change.path == "conflict.txt").unwrap();
        assert_eq!((conflict.index, conflict.worktree), ('A', 'A'));
        assert_eq!(next.changes.len(), 4);
        assert!(next.changes.iter().filter(|change| change.path != "conflict.txt")
            .all(|change| matches!(change.index, ' ' | '?')));
        assert_eq!(std::fs::read_to_string(folder.join("modified.txt")).unwrap(), "new content");
        assert!(folder.join("new [literal].txt").exists());
        assert!(!folder.join("removed.txt").exists());
        perform(root, Action::UnstageAll).unwrap();
    }

    #[test]
    fn publishes_current_branch_and_sets_upstream() {
        let repository = test_repository();
        let folder = &repository.0;
        let remote = folder.join(".git/test-remote.git");
        git(folder, &["init", "--bare", remote.to_str().unwrap()]).unwrap();
        git(folder, &["remote", "add", "origin", remote.to_str().unwrap()]).unwrap();
        git(folder, &["commit", "--allow-empty", "-m", "Base"]).unwrap();
        git(folder, &["switch", "-c", "feature/test"]).unwrap();
        assert!(!snapshot(folder).unwrap().has_upstream);
        let publish = |branch: &str, remote: &str| {
            perform(
                Some(folder.to_str().unwrap().into()),
                Action::PublishBranch { branch: branch.into(), remote: remote.into() },
            )
        };
        assert!(publish("main", "origin").is_err());
        assert!(publish("feature/test", "missing").is_err());
        let Response::Snapshot(published) = publish("feature/test", "origin").unwrap() else {
            panic!("Expected repository snapshot");
        };
        assert!(published.has_upstream);
        assert_eq!(published.ahead, Some(0));
        assert_eq!(
            git(folder, &["rev-parse", "--symbolic-full-name", "@{upstream}"]).unwrap().trim(),
            "refs/remotes/origin/feature/test"
        );
        assert!(publish("feature/test", "origin").is_err());
    }

    #[test]
    fn stages_and_unstages_individual_hunks() {
        let repository = test_repository();
        let folder = &repository.0;
        let path = "notes [draft].txt";
        let original = (0..30).map(|line| format!("line {line}\n")).collect::<String>();
        std::fs::write(folder.join(path), &original).unwrap();
        git(folder, &["add", "--", path]).unwrap();
        git(folder, &["commit", "-m", "Base"]).unwrap();

        let edited = original.replace("line 2\n", "first edit\n").replace("line 25\n", "second edit\n");
        std::fs::write(folder.join(path), &edited).unwrap();
        let complete = file_diff(folder, path, false, false).unwrap();
        let apply = |staged, expected_diff: &str, hunk| {
            perform(
                Some(folder.to_str().unwrap().into()),
                Action::ApplyHunk {
                    path: path.into(),
                    staged,
                    expected_diff: expected_diff.into(),
                    hunk,
                },
            )
        };
        apply(false, &complete, 1).unwrap();
        assert!(apply(false, &complete, 0).is_err());
        let working = file_diff(folder, path, false, false).unwrap();
        assert!(working.contains("+first edit"));
        assert!(!working.contains("+second edit"));
        let staged = file_diff(folder, path, true, false).unwrap();
        assert!(staged.contains("+second edit"));
        assert!(!staged.contains("+first edit"));

        apply(false, &working, 0).unwrap();
        let both = file_diff(folder, path, true, false).unwrap();
        apply(true, &both, 1).unwrap();
        let staged = file_diff(folder, path, true, false).unwrap();
        assert!(staged.contains("+first edit"));
        assert!(!staged.contains("+second edit"));
        assert!(file_diff(folder, path, false, false).unwrap().contains("+second edit"));
        assert_eq!(std::fs::read_to_string(folder.join(path)).unwrap(), edited);
    }

    #[test]
    fn local_workflow_from_untracked_file_to_commit() {
        let cleanup = test_repository();
        let folder = &cleanup.0;
        let path = "a [literal].txt".to_string();
        std::fs::write(folder.join(&path), "first line\n").unwrap();
        let opened = snapshot(folder).unwrap();
        assert_eq!(opened.branch, "main");
        assert_eq!(opened.changes[0].worktree, '?');
        assert!(opened.commits.is_empty());
        let root = Some(opened.root);
        assert!(snapshot(folder).unwrap().origin_url.is_none());
        perform(
            root.clone(),
            Action::SetOrigin {
                url: "https://example.invalid/old.git".into(),
            },
        )
        .unwrap();
        assert_eq!(
            snapshot(folder).unwrap().origin_url.as_deref(),
            Some("https://example.invalid/old.git")
        );
        git(
            folder,
            &[
                "remote",
                "set-url",
                "--push",
                "origin",
                "git@example.invalid:push.git",
            ],
        )
        .unwrap();
        git(
            folder,
            &[
                "remote",
                "add",
                "backup",
                "https://example.invalid/backup.git",
            ],
        )
        .unwrap();
        perform(
            root.clone(),
            Action::SetOrigin {
                url: "  git@example.invalid:new.git  ".into(),
            },
        )
        .unwrap();
        assert_eq!(
            snapshot(folder).unwrap().origin_url.as_deref(),
            Some("git@example.invalid:new.git")
        );
        assert_eq!(
            git(folder, &["remote", "get-url", "--push", "origin"])
                .unwrap()
                .trim(),
            "git@example.invalid:push.git"
        );
        assert_eq!(
            git(folder, &["remote", "get-url", "backup"])
                .unwrap()
                .trim(),
            "https://example.invalid/backup.git"
        );
        for invalid in ["", "  ", "--bad", "https://example.invalid/repo\nother"] {
            assert!(perform(
                root.clone(),
                Action::SetOrigin {
                    url: invalid.into()
                }
            )
            .is_err());
        }
        assert_eq!(
            snapshot(folder).unwrap().origin_url.as_deref(),
            Some("git@example.invalid:new.git")
        );
        let Response::Text(diff) = perform(
            root.clone(),
            Action::Diff {
                path: path.clone(),
                staged: false,
                untracked: true,
            },
        )
        .unwrap() else {
            panic!("Expected diff");
        };
        assert!(diff.contains("+first line"));
        perform(root.clone(), Action::Stage { path: path.clone() }).unwrap();
        perform(root.clone(), Action::Unstage { path: path.clone() }).unwrap();
        assert_eq!(snapshot(folder).unwrap().changes[0].index, '?');
        perform(root.clone(), Action::StageAll).unwrap();
        perform(root.clone(), Action::UnstageAll).unwrap();
        assert_eq!(snapshot(folder).unwrap().changes[0].index, '?');
        perform(root.clone(), Action::Stage { path }).unwrap();
        let Response::Snapshot(committed) = perform(
            root.clone(),
            Action::Commit {
                message: "First commit".into(),
            },
        )
        .unwrap() else {
            panic!("Expected repository snapshot");
        };
        assert!(committed.changes.is_empty());
        assert_eq!(committed.commits[0].subject, "First commit");
        std::fs::write(folder.join("bulk-one.txt"), "one").unwrap();
        std::fs::write(folder.join("bulk-two.txt"), "two").unwrap();
        assert!(discard_paths(folder, &["bulk-one.txt".into(), "../outside.txt".into()]).is_err());
        assert!(folder.join("bulk-one.txt").exists());
        discard_paths(
            folder,
            &[
                "bulk-one.txt".into(),
                "bulk-two.txt".into(),
                "bulk-one.txt".into(),
            ],
        )
        .unwrap();
        assert!(!folder.join("bulk-one.txt").exists());
        assert!(!folder.join("bulk-two.txt").exists());
        // Discard only the requested literal path, including staged edits.
        std::fs::write(folder.join("a [literal].txt"), "staged edit\n").unwrap();
        git(folder, &["add", "--", "a [literal].txt"]).unwrap();
        std::fs::write(folder.join("a [literal].txt"), "unstaged edit\n").unwrap();
        std::fs::write(folder.join("keep.txt"), "keep me\n").unwrap();
        perform(
            root.clone(),
            Action::Discard {
                path: "a [literal].txt".into(),
            },
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(folder.join("a [literal].txt")).unwrap(),
            "first line\n"
        );
        assert_eq!(
            std::fs::read_to_string(folder.join("keep.txt")).unwrap(),
            "keep me\n"
        );
        assert!(git(folder, &["diff", "--cached"]).unwrap().is_empty());
        std::fs::remove_file(folder.join("a [literal].txt")).unwrap();
        perform(
            root.clone(),
            Action::Discard {
                path: "a [literal].txt".into(),
            },
        )
        .unwrap();
        assert!(folder.join("a [literal].txt").exists());
        perform(
            root.clone(),
            Action::Discard {
                path: "keep.txt".into(),
            },
        )
        .unwrap();
        assert!(!folder.join("keep.txt").exists());
        std::fs::write(folder.join("new [file].txt"), "new\n").unwrap();
        git(folder, &["add", "--", "new [file].txt"]).unwrap();
        perform(
            root.clone(),
            Action::Discard {
                path: "new [file].txt".into(),
            },
        )
        .unwrap();
        assert!(!folder.join("new [file].txt").exists());
        assert!(perform(
            root.clone(),
            Action::Discard {
                path: "../outside.txt".into()
            }
        )
        .is_err());
        assert!(snapshot(folder).unwrap().changes.is_empty());
        let Response::Text(details) = perform(
            root,
            Action::Show {
                hash: committed.commits[0].hash.clone(),
            },
        )
        .unwrap() else {
            panic!("Expected commit details");
        };
        assert!(details.contains("+first line"));
        let folder_root = Some(committed.root.clone());
        std::fs::write(folder.join("a [literal].txt"), "second line\n").unwrap();
        git(folder, &["add", "--", "a [literal].txt"]).unwrap();
        git(folder, &["commit", "-m", "Second commit"]).unwrap();
        git(
            folder,
            &["update-ref", "refs/remotes/origin/topic/example", "HEAD"],
        )
        .unwrap();
        git(
            folder,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/topic/example",
            ],
        )
        .unwrap();
        let before_reset = snapshot(folder).unwrap();
        std::fs::write(folder.join("a [literal].txt"), "unstaged edit\n").unwrap();
        let Response::Snapshot(reset) = perform(
            folder_root,
            Action::ResetSoft {
                hash: committed.head.clone().unwrap(),
                branch: before_reset.branch,
                head: before_reset.head.unwrap(),
            },
        )
        .unwrap() else {
            panic!("Expected repository snapshot");
        };
        assert_eq!(reset.head, committed.head);
        assert_eq!(reset.remote_branches.len(), 1);
        let remote = &reset.remote_branches[0];
        assert_eq!(remote.name, "origin/topic/example");
        let Response::History(commits) = perform(
            Some(reset.root),
            Action::History {
                hash: remote.hash.clone(),
            },
        )
        .unwrap() else {
            panic!("Expected remote branch history");
        };
        assert_eq!(commits[0].subject, "Second commit");
        assert!(commits.iter().all(|commit| !commit.local_only));
        assert_eq!(snapshot(folder).unwrap().head, committed.head);
        assert!(git(folder, &["diff", "--cached"])
            .unwrap()
            .contains("+second line"));
        assert!(git(folder, &["diff"]).unwrap().contains("+unstaged edit"));
        std::fs::write(folder.join("draft.txt"), "untracked draft").unwrap();
        let Response::Snapshot(stashed) = perform(
            Some(committed.root.clone()),
            Action::Stash {
                message: "Test stash".into(),
            },
        )
        .unwrap() else {
            panic!("Expected repository snapshot");
        };
        assert!(!folder.join("draft.txt").exists());
        assert!(stashed.stashes[0].name.contains("Test stash"));
        let checkout = || {
            perform(
                Some(committed.root.clone()),
                Action::CheckoutRemote {
                    remote: "origin".into(),
                    branch: "topic/example".into(),
                },
            )
        };
        std::fs::write(folder.join("a [literal].txt"), "conflicting edit").unwrap();
        assert!(checkout().is_err());
        assert_eq!(snapshot(folder).unwrap().branch, "main");
        assert_eq!(
            std::fs::read_to_string(folder.join("a [literal].txt")).unwrap(),
            "conflicting edit"
        );
        git(folder, &["restore", "--", "a [literal].txt"]).unwrap();
        let Response::Snapshot(checked_out) = checkout().unwrap() else {
            panic!("Expected checkout snapshot");
        };
        assert_eq!(checked_out.branch, "topic/example");
        assert_eq!(
            git(
                folder,
                &["rev-parse", "--symbolic-full-name", "@{upstream}"]
            )
            .unwrap()
            .trim(),
            "refs/remotes/origin/topic/example"
        );
        git(folder, &["switch", "main"]).unwrap();
        let Response::Snapshot(existing) = checkout().unwrap() else {
            panic!("Expected checkout snapshot");
        };
        assert_eq!(existing.branch, "topic/example");
        assert_eq!(existing.head, checked_out.head);
        let Response::Snapshot(local) = perform(
            Some(existing.root),
            Action::CheckoutBranch {
                branch: "main".into(),
            },
        )
        .unwrap() else {
            panic!("Expected local checkout snapshot");
        };
        assert_eq!(local.branch, "main");
        assert_eq!(local.head, committed.head);
        let hash = remote.hash.clone();
        let Response::Snapshot(detached) = perform(
            Some(local.root.clone()),
            Action::CheckoutCommit { hash: hash.clone() },
        )
        .unwrap() else {
            panic!("Expected detached checkout snapshot");
        };
        assert_eq!(detached.branch, "Detached HEAD");
        assert_eq!(detached.head.as_deref(), Some(hash.as_str()));
        perform(
            Some(local.root.clone()),
            Action::Branch {
                name: "from-detached".into(),
                start: Some(hash.clone()),
            },
        )
        .unwrap();
        assert_eq!(
            git(folder, &["rev-parse", "refs/heads/from-detached"])
                .unwrap()
                .trim(),
            hash
        );
        checkout_branch(folder, "main").unwrap();
        let rename = |branch: &str, name: &str| {
            perform(
                Some(local.root.clone()),
                Action::RenameBranch {
                    branch: branch.into(),
                    name: name.into(),
                },
            )
        };
        assert!(rename("main", "from-detached").is_err());
        assert!(rename("main", "invalid name").is_err());
        let Response::Snapshot(renamed) = rename("main", "renamed-main").unwrap() else {
            panic!("Expected rename snapshot");
        };
        assert_eq!(renamed.branch, "renamed-main");
        assert_eq!(renamed.head, committed.head);
        rename("renamed-main", "main").unwrap();
        rename("from-detached", "feature/renamed").unwrap();
        assert_eq!(
            git(folder, &["rev-parse", "refs/heads/feature/renamed"]).unwrap().trim(),
            hash
        );
        rename("feature/renamed", "from-detached").unwrap();
        let delete = |branch: &str| {
            perform(
                Some(local.root.clone()),
                Action::DeleteBranch {
                    branch: branch.into(),
                },
            )
        };
        assert!(delete("main").is_err());
        git(folder, &["branch", "unmerged", &remote.hash]).unwrap();
        git(folder, &["commit", "--allow-empty", "-m", "Local commit"]).unwrap();
        let history = snapshot(folder).unwrap().commits;
        assert!(
            history
                .iter()
                .find(|commit| commit.subject == "Local commit")
                .unwrap()
                .local_only
        );
        assert!(
            !history
                .iter()
                .find(|commit| commit.subject == "Second commit")
                .unwrap()
                .local_only
        );
        assert!(delete("unmerged").is_err());
        let Response::Snapshot(deleted) = delete("topic/example").unwrap() else {
            panic!("Expected branch deletion snapshot");
        };
        assert!(!deleted
            .branches
            .iter()
            .any(|branch| branch.reference.name == "topic/example"));
        assert_eq!(deleted.remote_branches[0].name, "origin/topic/example");
    }
}
