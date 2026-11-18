import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowUpCircle, CheckCircle2, Database, ExternalLink, Terminal, Workflow, RefreshCw, X } from "lucide-react";
import { invoke as api, isTauri } from "@tauri-apps/api/core";
import { version as buildVersion } from "../src-tauri/tauri.conf.json";
import "./update-notice.css";

const projects = [
  { id: "dum-e", name: "DUM-E", description: "PostgreSQL and SQLite workspace", Icon: Database },
  { id: "ultron", name: "Ultron", description: "macOS terminal with split panes and SSH", Icon: Terminal },
  { id: "u", name: "U", description: "Local API workbench", Icon: Workflow },
];

const desktop = isTauri();
interface AvailableUpdate {
  version: string;
  url: string;
  notes: string;
}
const DAY = 24 * 60 * 60 * 1000;
export function UpdateNotice() {
  const [version, setVersion] = useState(buildVersion);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const [visible, setVisible] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const attempted = useRef<number | null>(null);
  const mounted = useRef(true);
  const check = useCallback(async (manual: boolean) => {
    if (!desktop || running.current) return;
    if (!manual && attempted.current !== null) {
      const elapsed = Date.now() - attempted.current;
      if (elapsed >= 0 && elapsed < DAY) return;
    }
    running.current = true;
    setChecking(true);
    setError("");
    attempted.current = Date.now();
    try {
      const available = await api<AvailableUpdate | null>("check_for_updates");
      if (!mounted.current) return;
      setUpdate(available);
      setCheckedAt(Date.now());
    } catch (error) {
      if (manual && mounted.current) setError(String(error));
    } finally {
      running.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (desktop)
      void getVersion()
        .then((value) => {
          if (mounted.current) setVersion(value);
        })
        .catch(() => {});
    const initial = setTimeout(() => void check(false), 3000);
    const interval = setInterval(() => void check(false), 60 * 60 * 1000);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [check]);
  useEffect(() => {
    if (visible) dialog.current?.showModal();
    else dialog.current?.close();
  }, [visible]);
  async function openRelease() {
    setOpening(true);
    setError("");
    try {
      await api("open_release_page", {
        url: update?.url ?? null,
      });
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      if (mounted.current) setOpening(false);
    }
  }
  async function openProject(project: string) {
    setError("");
    try {
      await api("open_related_project", { project });
    } catch (error) {
      if (mounted.current) setError(String(error));
    }
  }

  const status = checking
    ? "Checking for updates…"
    : update
      ? "A new version is available"
      : error
        ? "Update check unavailable"
        : checkedAt
        ? "You’re up to date"
        : "Ready to check for updates";
  return (
    <div className="app-updates">
      <button
        className="update-nav-button"
        onClick={() => {
          setVisible(true);
          if (!checkedAt) void check(true);
        }}
        title={`Updates · v${version}${update ? ` · New version ${update.version}` : ""}`}
        aria-label={`Updates · v${version}${update ? ` · Version ${update.version} available` : ""}`}
        aria-haspopup="dialog"
      >
        {checking ? (
          <RefreshCw size={14} className="update-spinning" aria-hidden="true" />
        ) : (
          <ArrowUpCircle size={14} aria-hidden="true" />
        )}
        <span className="update-nav-version">v{version}</span>
        {update && (
          <span
            className="update-new-badge"
            aria-hidden="true"
          >
            New
          </span>
        )}
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="updates-dialog"
          aria-labelledby="updates-title"
          onCancel={() => setVisible(false)}
          onClose={() => setVisible(false)}
        >
          <header className="updates-heading">
            <h2 id="updates-title">Updates</h2>
            <button
              type="button"
              aria-label="Close updates"
              onClick={() => setVisible(false)}
            >
              <X size={18} />
            </button>
          </header>
          <div className="updates-body">
            {!desktop && (
              <p className="updates-error" role="status">
                Update checks are available in the Natalie desktop app.
              </p>
            )}
            {error && (
              <p className="updates-error" role="alert">
                {error}
              </p>
            )}
            <section className="updates-hero" aria-live="polite">
              <img className="updates-mark" src="/natalie-mark.svg" alt="" />
              <div>
                <h3>{status}</h3>
                <p>
                  Installed <strong>{version}</strong>
                  {update && (
                    <>
                      {" "}
                      <span>→</span> Available <strong>{update.version}</strong>
                    </>
                  )}
                </p>
              </div>
              <span className="updates-channel">
                {version.includes("-") ? "Preview channel" : "Stable channel"}
              </span>
            </section>
            <div className="updates-toolbar">
              <button
                className="updates-action"
                disabled={!desktop || checking}
                onClick={() => void check(true)}
              >
                <RefreshCw
                  size={14}
                  className={checking ? "update-spinning" : ""}
                />
                {checking ? "Checking…" : "Check for updates"}
              </button>
              <button
                className={`updates-action${update ? " primary" : ""}`}
                disabled={!desktop || opening}
                onClick={() => void openRelease()}
              >
                <ExternalLink size={14} aria-hidden="true" />
                {opening ? "Opening…" : update ? "Download macOS update" : "View releases"}
              </button>
            </div>
            {update && (
              <p className="updates-instructions">
                Download the DMG, quit Natalie, then replace it in Applications.
              </p>
            )}
            {update?.notes && (
              <section className="updates-notes">
                <h3>
                  <CheckCircle2 size={16} />
                  What’s new in {update.version}
                </h3>
                <pre>{update.notes}</pre>
              </section>
            )}
            {checkedAt && (
              <small className="updates-instructions">
                Last checked {new Date(checkedAt).toLocaleString()}.
              </small>
            )}
            <section className="updates-projects" aria-labelledby="updates-projects-title">
              <h3 id="updates-projects-title">More apps from Duckfollow</h3>
              <ul>
                {projects.map(({ id, name, description, Icon }) => (
                  <li key={id}>
                    <button type="button" disabled={!desktop} onClick={() => void openProject(id)}>
                      <Icon size={17} aria-hidden="true" />
                      <span><strong>{name}</strong><small>{description}</small></span>
                      <ExternalLink size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </dialog>,
        document.body,
      )}
    </div>
  );
}
