import { useEffect, useRef, useState } from "react";
import { Check, Download, FolderGit2, FolderOpen, History, Search, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

export type CloneTarget = { url: string; parent: string; name: string };

export function RepositoryPicker({
  initialView,
  recent,
  currentPath,
  busy,
  error,
  onClose,
  onOpen,
  onChoose,
  onForget,
  onClone,
}: {
  initialView: "repositories" | "clone";
  recent: string[];
  currentPath?: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onOpen: (path: string) => void;
  onChoose: () => void;
  onForget: (path: string) => void;
  onClone: (target: CloneTarget) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState(initialView);
  const [filter, setFilter] = useState("");
  const filtered = recent.filter((path) => path.toLowerCase().includes(filter.trim().toLowerCase()));
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [pickerError, setPickerError] = useState("");
  const suggestedName =
    url
      .trim()
      .replace(/\/+$/, "")
      .split(/[/:]/)
      .at(-1)
      ?.replace(/\.git$/, "") ?? "";
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function chooseParent() {
    try {
      const folder = await open({ directory: true, multiple: false });
      if (folder) setParent(folder);
      setPickerError("");
    } catch (error) {
      setPickerError(String(error));
    }
  }

  return (
    <dialog
      ref={dialog}
      className="repo-picker"
      aria-labelledby="repo-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <FolderGit2 size={19} aria-hidden="true" />
        <h2 id="repo-picker-title">Repositories</h2>
        <button
          type="button"
          className="repo-picker-close"
          aria-label="Close repositories"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <nav aria-label="Repository actions">
        <button
          type="button"
          aria-pressed={view === "repositories"}
          disabled={busy}
          onClick={() => setView("repositories")}
        >
          <History size={15} aria-hidden="true" /> Recent
        </button>
        <button
          type="button"
          aria-pressed={view === "clone"}
          disabled={busy}
          onClick={() => setView("clone")}
        >
          <Download size={15} aria-hidden="true" /> Clone
        </button>
      </nav>
      {(pickerError || error) && (
        <p className="picker-error" role="alert">
          {pickerError || error}
        </p>
      )}
      {view === "repositories" ? (
        <div className="repo-picker-content repo-picker-recent">
          {recent.length > 0 && (
            <div className="repo-picker-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search recent repositories"
                placeholder="Search repositories"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          )}
          {filtered.length ? (
            <ul className="repo-list">
              {filtered.map((path) => {
                const name = path.split("/").at(-1) || path;
                const isCurrent = currentPath === path;
                return (
                  <li key={path} data-current={isCurrent}>
                    <button
                      type="button"
                      className="repo-list-item"
                      aria-current={isCurrent ? "true" : undefined}
                      disabled={busy}
                      onClick={() => onOpen(path)}
                    >
                      <FolderGit2 size={17} aria-hidden="true" />
                      <span className="repo-list-details">
                        <strong title={name}>{name}</strong>
                        <small title={path}>{path}</small>
                      </span>
                      {isCurrent && <Check size={15} aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      className="repo-picker-close"
                      disabled={busy}
                      aria-label={`Remove ${name} from recent repositories`}
                      title="Remove from recent repositories"
                      onClick={() => onForget(path)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="repo-picker-empty" role="status">
              {recent.length ? "No matching repositories." : "No recent repositories."}
            </p>
          )}
          <footer className="repo-picker-footer">
            <button className="primary" disabled={busy} onClick={onChoose}>
              <FolderOpen size={15} aria-hidden="true" /> Open local folder
            </button>
          </footer>
        </div>
      ) : (
        <form
          className="repo-picker-content"
          onSubmit={(event) => {
            event.preventDefault();
            onClone({
              url: url.trim(),
              parent,
              name: name.trim() || suggestedName,
            });
          }}
        >
          <label>
            Repository URL
            <input
              autoFocus
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/owner/repo.git"
              required
            />
          </label>
          <div className="clone-destination">
            <label>
              Destination folder
              <input
                readOnly
                value={parent}
                placeholder="Choose a parent folder"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void chooseParent()}
            >
              <FolderOpen size={15} aria-hidden="true" /> Browse
            </button>
          </div>
          <label>
            New folder name
            <input
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder={suggestedName || "repository-name"}
            />
          </label>
          <button
            className="primary"
            disabled={
              busy || !url.trim() || !parent || !(name.trim() || suggestedName)
            }
          >
            <Download size={15} aria-hidden="true" />{" "}
            {busy ? "Cloning…" : "Clone repository"}
          </button>
        </form>
      )}
    </dialog>
  );
}
