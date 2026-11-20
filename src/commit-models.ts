export const commitModels = [
  {
    id: "smollm2-135m", label: "SmolLM2 135M Q4",
    repository: "onnx-community/SmolLM2-135M-Instruct-ONNX-MHA",
    revision: "5b6682c7c9df18f004bfb7e635cba3f3d98537d8",
    description: "182 MB · smallest", timeout: 180_000,
  },
  {
    id: "smollm2-360m", label: "SmolLM2 360M Q4",
    repository: "HuggingFaceTB/SmolLM2-360M-Instruct",
    revision: "a10cc1512eabd3dde888204e902eca88bddb4951",
    description: "388 MB · larger model", timeout: 300_000,
  },
] as const;

export type CommitModelId = typeof commitModels[number]["id"];

export function commitModel(id: string) {
  const model = commitModels.find(model => model.id === id);
  if (!model) throw Error("Unknown commit model.");
  return model;
}
