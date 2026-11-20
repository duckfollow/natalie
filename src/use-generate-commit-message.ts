import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { canReplaceGeneratedMessage, suggestCommitMessages, type CommitMessageContext } from "./commit-message";

export function useGenerateCommitMessage({ root, enabled, message, setMessage }: {
  root: string | null;
  enabled: boolean;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
}) {
  const latest = useRef(message);
  latest.current = message;
  const request = useRef(0);
  const inFlight = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<{ text: string; truncated: boolean } | null>(null);
  useEffect(() => {
    request.current++;
    inFlight.current = false;
    setWorking(false);
    setError("");
    setGenerated(null);
    return () => { request.current++; };
  }, [root, enabled]);

  async function generate() {
    if (!root || !enabled || inFlight.current) return;
    inFlight.current = true;
    const current = ++request.current;
    const startedWith = latest.current;
    setWorking(true);
    setError("");
    try {
      const context = await invoke<CommitMessageContext>("repository", { root, action: { kind: "commit_message_context" } });
      if (request.current !== current) return;
      const next = suggestCommitMessages(context).messages[0];
      if (!next) throw Error("Stage changes before generating a commit message.");
      await invoke("repository", { root, action: { kind: "check_commit_message_index", tree: context.tree, head: context.head, branch: context.branch } });
      if (request.current !== current) return;
      if (!canReplaceGeneratedMessage(latest.current, startedWith)) {
        setError("The message was edited while generating. Click Generate message to replace it.");
        return;
      }
      setMessage(value => canReplaceGeneratedMessage(value, startedWith) ? next : value);
      setGenerated({ text: next, truncated: context.truncated });
      document.getElementById("commit-message")?.focus();
    } catch (failure) {
      if (request.current === current) setError(String(failure));
    } finally {
      if (request.current === current) { inFlight.current = false; setWorking(false); }
    }
  }
  return { generate, working, error, truncated: generated?.truncated && message === generated.text };
}
