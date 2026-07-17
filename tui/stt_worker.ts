// Speech-recognition worker: OpenAI Whisper (tiny.en) via transformers.js
// on onnxruntime's CPU engine (Deno's Node compat loads the native binding
// through --allow-ffi). The model (~40MB, quantized) downloads once into
// tui/.cache/ and is reused offline afterwards.
//
// Protocol: {type:"init"} → {type:"progress"|"ready"|"error"}
//           {type:"transcribe", audio: ArrayBuffer (Float32 16kHz mono)}
//             → {type:"transcript", text}

/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { env, pipeline } from "npm:@huggingface/transformers@3";

env.cacheDir = new URL("./.cache/transformers/", import.meta.url).pathname;

// deno-lint-ignore no-explicit-any
let transcriber: any = null;
let lastProgress = -1;

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;

  if (message.type === "init") {
    try {
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-tiny.en",
        {
          device: "cpu",
          dtype: "q8",
          // deno-lint-ignore no-explicit-any
          progress_callback: (p: any) => {
            if (p.status === "progress" && typeof p.progress === "number") {
              const pct = Math.floor(p.progress);
              if (pct !== lastProgress) {
                lastProgress = pct;
                self.postMessage({ type: "progress", pct, file: p.file ?? "" });
              }
            }
          },
        },
      );
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
    return;
  }

  if (message.type === "transcribe" && transcriber) {
    try {
      const audio = new Float32Array(message.audio);
      const out = await transcriber(audio);
      self.postMessage({ type: "transcript", text: String(out?.text ?? "") });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};
