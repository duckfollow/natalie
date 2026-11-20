use serde::Serialize;
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
};

const MAX_DIFF_BYTES: usize = 128 * 1024;
const MAX_FILE_DIFF_BYTES: usize = 8 * 1024;
const MAX_ANALYZED_FILES: usize = 40;

#[derive(Serialize)]
pub struct StagedFile {
    path: String,
    previous_path: Option<String>,
    status: String,
    diff: String,
    binary: bool,
    omitted: bool,
}

struct CommitMessageVersion {
    tree: String,
    head: Option<String>,
    branch: String,
}

fn version(root: &Path) -> Result<CommitMessageVersion, String> {
    Ok(CommitMessageVersion {
        tree: super::git(root, &["write-tree"])?.trim().to_owned(),
        head: super::git(root, &["rev-parse", "--verify", "HEAD"])
            .ok()
            .map(|hash| hash.trim().to_owned()),
        branch: super::git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
            .unwrap_or_default()
            .trim()
            .to_owned(),
    })
}

#[derive(Serialize)]
pub struct CommitMessageContext {
    tree: String,
    head: Option<String>,
    branch: String,
    subjects: Vec<String>,
    files: Vec<StagedFile>,
    truncated: bool,
}

fn generated(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    matches!(
        name,
        "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock" | "Cargo.lock"
    ) || name.ends_with(".lock")
        || name.ends_with(".min.js")
        || name.ends_with(".map")
        || path
            .split('/')
            .any(|part| matches!(part, "node_modules" | "dist" | "vendor" | "generated"))
}

fn read_diff(root: &Path, path: &str, limit: usize) -> Result<(String, bool), String> {
    let mut child = Command::new("/usr/bin/git")
        .current_dir(root)
        .args([
            "--no-pager",
            "--literal-pathspecs",
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=2",
            "--",
            path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .ok_or("Could not read Git output")?
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes);
    if let Err(error) = read {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.to_string());
    }
    let truncated = bytes.len() > limit;
    if truncated {
        let _ = child.kill();
        bytes.truncate(limit);
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !truncated && !status.success() {
        return Err(format!("Could not read staged changes for {path}"));
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

pub fn context(root: &Path) -> Result<CommitMessageContext, String> {
    let CommitMessageVersion { tree, head, branch } = version(root)?;
    let names = super::git(
        root,
        &[
            "diff",
            "--cached",
            "--name-status",
            "-z",
            "--find-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--",
        ],
    )?;
    let mut fields = names.split('\0').filter(|field| !field.is_empty());
    let mut files = Vec::new();
    let mut remaining = MAX_DIFF_BYTES;
    let mut analyzed = 0;
    let mut truncated = false;
    while let Some(status) = fields.next() {
        let first_path = fields.next().ok_or("Unexpected staged file record")?;
        let (path, previous_path) = if status.starts_with(['R', 'C']) {
            (
                fields.next().ok_or("Unexpected staged rename record")?,
                Some(first_path.to_owned()),
            )
        } else {
            (first_path, None)
        };
        if status.starts_with('U') {
            return Err("Resolve conflicts before suggesting a commit message.".into());
        }
        let omitted = generated(path) || analyzed >= MAX_ANALYZED_FILES || remaining == 0;
        let (diff, shortened) = if omitted {
            (String::new(), false)
        } else {
            analyzed += 1;
            read_diff(root, path, remaining.min(MAX_FILE_DIFF_BYTES))?
        };
        remaining = remaining.saturating_sub(diff.len());
        truncated |= shortened || (omitted && !generated(path));
        let binary = diff
            .lines()
            .any(|line| line.starts_with("Binary files ") || line == "GIT binary patch");
        files.push(StagedFile {
            path: path.into(),
            previous_path,
            status: status[..1].into(),
            diff,
            binary,
            omitted,
        });
    }
    if files.is_empty() {
        return Err("Stage changes before suggesting a commit message.".into());
    }
    check_context(root, &tree, head.as_deref(), &branch)?;
    let subjects = super::git(
        root,
        &[
            "log",
            "--no-show-signature",
            "--no-decorate",
            "-12",
            "--format=%s",
        ],
    )
    .unwrap_or_default()
    .lines()
    .map(str::to_owned)
    .collect();
    Ok(CommitMessageContext {
        tree,
        head,
        branch,
        subjects,
        files,
        truncated,
    })
}

pub fn check_context(
    root: &Path,
    expected: &str,
    head: Option<&str>,
    branch: &str,
) -> Result<(), String> {
    super::validate_commit_hash(expected)?;
    if let Some(head) = head {
        super::validate_commit_hash(head)?;
    }
    let current_head = super::git(root, &["rev-parse", "--verify", "HEAD"]).ok();
    let current_branch =
        super::git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_default();
    if super::git(root, &["write-tree"])?.trim() != expected
        || current_head.as_deref().map(str::trim) != head
        || current_branch.trim() != branch
    {
        return Err(
            "Staged changes or the current branch changed. Generate suggestions again.".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn context_reads_only_staged_content_and_detects_index_changes() {
        let repo = crate::tests::test_repository();
        let root = &repo.0;
        std::fs::write(root.join("file [one].ts"), "export function oldName() {}\n").unwrap();
        crate::git(root, &["add", "--", "file [one].ts"]).unwrap();
        let initial = context(root).unwrap();
        assert_eq!(initial.files.len(), 1);
        std::fs::write(root.join("file [one].ts"), "UNSTAGED_ONLY\n").unwrap();
        let staged = context(root).unwrap();
        assert!(staged.files[0].diff.contains("oldName"));
        assert!(!staged.files[0].diff.contains("UNSTAGED_ONLY"));
        check_context(
            root,
            &initial.tree,
            initial.head.as_deref(),
            &initial.branch,
        )
        .unwrap();
        crate::git(root, &["add", "--", "file [one].ts"]).unwrap();
        assert!(check_context(
            root,
            &initial.tree,
            initial.head.as_deref(),
            &initial.branch
        )
        .is_err());
        let before_commit = context(root).unwrap();
        crate::git(root, &["commit", "-m", "Changed HEAD"]).unwrap();
        assert!(check_context(
            root,
            &before_commit.tree,
            before_commit.head.as_deref(),
            &before_commit.branch
        )
        .is_err());
        let head = crate::git(root, &["rev-parse", "HEAD"]).unwrap();
        crate::git(root, &["checkout", "-b", "other-branch"]).unwrap();
        assert!(check_context(root, &before_commit.tree, Some(head.trim()), "main").is_err());
    }
    #[test]
    fn context_handles_renames_binary_lockfiles_and_large_diffs() {
        let repo = crate::tests::test_repository();
        let root = &repo.0;
        assert!(context(root).is_err());
        std::fs::write(root.join("old name.txt"), "Original fixture content\n").unwrap();
        crate::git(root, &["add", "--", "old name.txt"]).unwrap();
        crate::git(root, &["commit", "-m", "Initial fixture"]).unwrap();
        crate::git(root, &["mv", "--", "old name.txt", "new name.txt"]).unwrap();
        std::fs::write(root.join("image.bin"), [0u8, 1, 2, 0, 4]).unwrap();
        std::fs::write(root.join("Cargo.lock"), "dependency fixture\n".repeat(1000)).unwrap();
        std::fs::write(
            root.join("large.ts"),
            "export const fixture = true;\n".repeat(3000),
        )
        .unwrap();
        crate::git(root, &["add", "--all"]).unwrap();
        let value = context(root).unwrap();
        assert!(value.truncated);
        let renamed = value
            .files
            .iter()
            .find(|file| file.path == "new name.txt")
            .unwrap();
        assert_eq!(renamed.status, "R");
        assert_eq!(renamed.previous_path.as_deref(), Some("old name.txt"));
        assert!(
            value
                .files
                .iter()
                .find(|file| file.path == "image.bin")
                .unwrap()
                .binary
        );
        let lock = value
            .files
            .iter()
            .find(|file| file.path == "Cargo.lock")
            .unwrap();
        assert!(lock.omitted && lock.diff.is_empty());
        assert!(value
            .files
            .iter()
            .all(|file| file.diff.len() <= MAX_FILE_DIFF_BYTES));
        assert_eq!(value.subjects, ["Initial fixture"]);
        check_context(root, &value.tree, value.head.as_deref(), &value.branch).unwrap();
    }
}
