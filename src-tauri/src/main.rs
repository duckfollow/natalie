#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    process::{Command, Output},
};

#[derive(Serialize)]
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
}

#[derive(Serialize)]
struct Reference {
    name: String,
    hash: String,
}

#[derive(Serialize)]
struct Snapshot {
    root: String,
    branch: String,
    changes: Vec<Change>,
    commits: Vec<Commit>,
    branches: Vec<Reference>,
    tags: Vec<Reference>,
    remotes: Vec<String>,
    stashes: Vec<Reference>,
    submodules: Vec<String>,
    cherry_picking: bool,
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
        Some("diff" | "add" | "restore" | "rm")
    ) {
        command.arg("--literal-pathspecs");
    }
    if args == ["cherry-pick", "--continue"] {
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

fn snapshot(folder: &Path) -> Result<Snapshot, String> {
    let root = git(folder, &["rev-parse", "--show-toplevel"])?;
    let root = root.trim_end_matches('\n').to_owned();
    let path = Path::new(&root);
    let has_head = run(path, &["rev-parse", "--verify", "HEAD"])?
        .status
        .success();
    let branch = git(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .map(|name| name.trim_end().to_owned())
        .unwrap_or_else(|_| "Detached HEAD".to_owned());
    let status = run(
        path,
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
    let changes = status
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
        .collect::<Result<Vec<_>, String>>()?;
    let mut commits = Vec::new();
    if has_head {
        let log = git(
            path,
            &[
                "log",
                "-z",
                "--topo-order",
                "--branches",
                "--decorate=short",
                "-n",
                "100",
                "--format=%H%x00%an%x00%aI%x00%s%x00%P%x00%D",
                "HEAD",
                "--",
            ],
        )?;
        let fields = log
            .strip_suffix('\0')
            .unwrap_or(&log)
            .split('\0')
            .collect::<Vec<_>>();
        for record in fields.chunks_exact(6) {
            commits.push(Commit {
                hash: record[0].to_owned(),
                author: record[1].to_owned(),
                date: record[2].to_owned(),
                subject: record[3].to_owned(),
                parents: record[4].split_whitespace().map(str::to_owned).collect(),
                refs: record[5].to_owned(),
            });
        }
    }
    let references = |args: &[&str]| -> Result<Vec<Reference>, String> {
        Ok(git(path, args)?
            .lines()
            .filter_map(|line| {
                let (hash, name) = line.split_once('\0')?;
                Some(Reference {
                    name: name.to_owned(),
                    hash: hash.to_owned(),
                })
            })
            .collect())
    };
    let branches = references(&[
        "for-each-ref",
        "--format=%(objectname)%00%(refname:strip=2)",
        "refs/heads",
    ])?;
    let tags = references(&[
        "for-each-ref",
        "--format=%(objectname)%00%(refname:strip=2)",
        "refs/tags",
    ])?;
    let remotes = git(path, &["remote"])?.lines().map(str::to_owned).collect();
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
    Ok(Snapshot {
        root,
        branch,
        changes,
        commits,
        branches,
        tags,
        remotes,
        stashes,
        submodules,
        cherry_picking,
    })
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Action {
    Open {
        folder: String,
    },
    Clone {
        url: String,
        parent: String,
        name: String,
    },
    Diff {
        path: String,
        staged: bool,
        untracked: bool,
    },
    Stage {
        path: String,
    },
    Unstage {
        path: String,
    },
    Commit {
        message: String,
    },
    Fetch,
    Pull,
    Push,
    Branch {
        name: String,
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
    },
    ContinueCherryPick,
    AbortCherryPick,
    Show {
        hash: String,
    },
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    Snapshot(Snapshot),
    Text(String),
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
        Action::Diff {
            path,
            staged,
            untracked,
        } => {
            let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
            if untracked {
                args.extend(["--no-index", "--", "/dev/null", &path]);
            } else {
                if staged {
                    args.push("--cached");
                }
                args.extend(["--", &path]);
            }
            output(run(root, &args)?, untracked).map(Response::Text)
        }
        Action::Show { hash } => {
            if !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Invalid commit hash.".into());
            }
            git(
                root,
                &[
                    "show",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-color",
                    "--format=fuller",
                    &hash,
                    "--",
                ],
            )
            .map(Response::Text)
        }
        action => {
            match action {
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
                Action::Push => {
                    git(root, &["push"])?;
                }
                Action::Branch { name } => {
                    git(root, &["branch", "--", &name])?;
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
                Action::CherryPick { hash, mainline } => {
                    if !matches!(hash.len(), 40 | 64)
                        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
                    {
                        return Err("Invalid commit hash.".into());
                    }
                    let parent = mainline.map(|parent| parent.to_string());
                    let mut args = vec!["cherry-pick"];
                    if let Some(parent) = parent.as_deref() {
                        args.extend(["--mainline", parent]);
                    }
                    args.extend(["--", &hash]);
                    git(root, &args)?;
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![repository])
        .run(tauri::generate_context!())
        .expect("Natalie could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_workflow_from_untracked_file_to_commit() {
        let folder = std::env::temp_dir().join(format!(
            "natalie-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&folder).unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let cleanup = Cleanup(folder);
        let folder = &cleanup.0;
        git(folder, &["init", "-b", "main"]).unwrap();
        git(folder, &["config", "user.name", "Natalie Test"]).unwrap();
        git(folder, &["config", "user.email", "test@example.invalid"]).unwrap();
        git(folder, &["config", "commit.gpgsign", "false"]).unwrap();
        git(folder, &["config", "core.hooksPath", "/dev/null"]).unwrap();
        let path = "a [literal].txt".to_string();
        std::fs::write(folder.join(&path), "first line\n").unwrap();
        let opened = snapshot(folder).unwrap();
        assert_eq!(opened.branch, "main");
        assert_eq!(opened.changes[0].worktree, '?');
        assert!(opened.commits.is_empty());
        let root = Some(opened.root);
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
        std::fs::write(folder.join("draft.txt"), "untracked draft").unwrap();
        let Response::Snapshot(stashed) = perform(
            Some(committed.root),
            Action::Stash {
                message: "Test stash".into(),
            },
        )
        .unwrap() else {
            panic!("Expected repository snapshot");
        };
        assert!(!folder.join("draft.txt").exists());
        assert!(stashed.stashes[0].name.contains("Test stash"));
    }
}
