import { commitModel, type CommitModelId } from "./commit-models";
import { bestCandidate } from "./commit-message-ranking";
import { env, pipeline } from "@huggingface/transformers";
// Ship the runtime with the app. Only model files are fetched on opt-in.
import wasmUrl from "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import moduleUrl from "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url";

env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.wasmPaths = { wasm: wasmUrl, mjs: moduleUrl };

self.onmessage = async ({ data }: MessageEvent<{ prompt: string; candidates: string[]; modelId: CommitModelId }>) => {
  let stage = "download";
  try {
    const model = commitModel(data.modelId);
    self.postMessage({ progress: `Loading ${model.label}…` });
    const generator = await pipeline("text-generation", model.repository, {
      progress_callback: (event) => {
        if (event.status === "progress") {
          const percent = Math.round(event.progress);
          self.postMessage({ progress: `Downloading model · ${percent}%` });
        }
      },
      dtype: "q4", device: "wasm", revision: model.revision,
    });
    stage = "inference";
    self.postMessage({ progress: "Drafting locally…" });
    // Rank only valid candidate labels with the next-token logits. The model
    // cannot emit repeated paths, code, or free-form explanations here.
    try {
      const inputs = generator.tokenizer(data.prompt);
      const output = await generator.model(inputs);
      const logits = output.logits;
      const vocabularySize = logits.dims[logits.dims.length - 1];
      const offset = logits.data.length - vocabularySize;
      const scores = data.candidates.map((_, index) => {
        const ids = generator.tokenizer.encode(String(index + 1), { add_special_tokens: false });
        if (ids.length !== 1) throw Error("Candidate label must be a single token.");
        return Number(logits.data[offset + ids[0]]);
      });
      self.postMessage({ text: data.candidates[bestCandidate(scores)] });
    } finally {
      await generator.dispose();
    }
  } catch (error) {
    console.error("Commit model failed during " + stage, error);
    self.postMessage({ error: stage === "download"
      ? "Model download or runtime initialization failed. Check your connection and retry."
      : "The model loaded, but local inference failed." });
  }
};
