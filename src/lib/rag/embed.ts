/**
 * Local sentence embeddings via Transformers.js.
 * Model: Xenova/all-MiniLM-L6-v2 (384 dims). Downloads to .cache on first call.
 */
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers"

// disable HF Hub progress bars in console; allow remote model fetch on first run
env.allowLocalModels = true
env.allowRemoteModels = true

let pipePromise: Promise<FeatureExtractionPipeline> | null = null

export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!pipePromise) {
    pipePromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: "q8",
    }) as unknown as Promise<FeatureExtractionPipeline>
  }
  return pipePromise
}

export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getEmbedder()
  const out = await pipe(text, { pooling: "mean", normalize: true })
  return new Float32Array(out.data as Float32Array)
}

export async function embedMany(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getEmbedder()
  const result: Float32Array[] = []
  for (const t of texts) {
    const out = await pipe(t, { pooling: "mean", normalize: true })
    result.push(new Float32Array(out.data as Float32Array))
  }
  return result
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot // both normalized → dot == cosine
}

export function bytesToFloat32(b: Uint8Array): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4))
}

export function float32ToBytes(f: Float32Array): Buffer {
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength)
}
