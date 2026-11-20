import { commitModel, type CommitModelId } from "./commit-models";
import { generateWithLocalModel, ModelResponseError } from "./commit-message-ai";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { canReplaceGeneratedMessage, formatCommitMessage, suggestCommitMessages, type MessageDetail, type CommitMessageContext } from "./commit-message";

export function useGenerateCommitMessage({ root, enabled, message, setMessage }: {
  root: string | null;
  enabled: boolean;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
}) {
  const [detail, setDetail] = useState<MessageDetail>("short");
  const detailRef = useRef<MessageDetail>("short");
  const [modelId, setModelId] = useState<CommitModelId>("smollm2-135m");
  const [useModel, setUseModel] = useState(true);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [modelResponse, setModelResponse] = useState("");
  const [status, setStatus] = useState("");
  const latest = useRef(message);
  latest.current = message;
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<{
    text: string; title: string; context: CommitMessageContext; truncated: boolean;
  } | null>(null);

  function changeDetail(value: MessageDetail) {
    detailRef.current = value;
    setDetail(value);
    if (!generated || latest.current !== generated.text) return;
    const text = formatCommitMessage(generated.title, generated.context, value);
    setMessage(current => current === generated.text ? text : current);
    latest.current = text;
    setGenerated({ ...generated, text });
  }
  useEffect(() => {
    controller.current?.abort();
    request.current++;
    inFlight.current = false;
    setWorking(false);
    setError("");
    setStatus("");
    setModelResponse("");
    setGenerated(null);
    return () => { request.current++; controller.current?.abort(); };
  }, [root, enabled]);

  function changeGenerator(useAI: boolean) {
    if (inFlight.current) return;
    setUseModel(useAI);
    setError("");
    setStatus("");
    setModelResponse("");
  }

  function changeModel(id: CommitModelId) {
    if (inFlight.current) return;
    if (id !== modelId) setAiReady(null);
    setModelId(id);
    changeGenerator(true);
  }

  async function generate() {
    if (!root || !enabled || inFlight.current) return;
    inFlight.current = true;
    const current = ++request.current;
    const startedWith = latest.current;
    const abort = new AbortController();
    controller.current = abort;
    setStatus("");
    setModelResponse("");
    setWorking(true);
    setError("");
    try {
      const context = await invoke<CommitMessageContext>("repository", { root, action: { kind: "commit_message_context" } });
      if (request.current !== current) return;
      let next = suggestCommitMessages(context).messages[0];
      let source = "Generated from staged changes using rules.";
      if (useModel) {
        try {
          next = await generateWithLocalModel(context, (text) => {
            if (request.current === current) {
              setStatus(text);
              if (text === "Drafting locally…") setAiReady(true);
            }
          }, abort.signal, modelId);
          source = `Selected locally with ${commitModel(modelId).label} from staged-diff suggestions.`;
        } catch (failure) {
          setAiReady(false);
          if (request.current === current && failure instanceof ModelResponseError) setModelResponse(failure.response);
          const reason = failure instanceof Error ? failure.message : "Local AI failed.";
          if (request.current === current) setError(`${reason} A rule-based draft was generated instead.`);
          source = `${reason} Used staged-diff rules instead.`;
        }
      }
      if (request.current !== current) return;
      if (!next) throw Error("Stage changes before generating a commit message.");
      await invoke("repository", { root, action: { kind: "check_commit_message_index", tree: context.tree, head: context.head, branch: context.branch } });
      if (request.current !== current) return;
      if (!canReplaceGeneratedMessage(latest.current, startedWith)) {
        setError("The message was edited while generating. Click Generate message to replace it.");
        return;
      }
      const title = next;
      next = formatCommitMessage(title, context, detailRef.current);
      setMessage(value => canReplaceGeneratedMessage(value, startedWith) ? next : value);
      setGenerated({ text: next, title, context, truncated: context.truncated });
      setStatus(source);
      document.getElementById("commit-message")?.focus();
    } catch (failure) {
      if (request.current === current) setError(String(failure));
    } finally {
      if (request.current === current) { inFlight.current = false; setWorking(false); }
    }
  }
  return { generate, working, error, status, modelId, setModelId: changeModel, modelResponse, aiReady, detail, setDetail: changeDetail, useModel, setUseModel: changeGenerator, truncated: generated?.truncated && message === generated.text };
}
