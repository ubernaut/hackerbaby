// Voice input for the picture game: records short mic chunks with
// arecord/pw-record (16kHz mono s16le), drops silent ones, and transcribes
// the rest with the Whisper WASM worker (stt_worker.ts). A custom engine
// can be substituted with --stt-cmd="whisper-cli -f {wav}" — anything that
// prints a transcript to stdout.

const CHUNK_SECONDS = 3;
const SAMPLE_RATE = 16000;
const RMS_SILENCE = 260; // of 32768 — below this the chunk is considered silence

export interface VoiceInput {
  available: boolean;
  reason: string;
  start(): void;
  stop(): void;
}

interface VoiceCallbacks {
  onTranscript(text: string): void;
  onStatus(text: string): void;
}

type Recorder = { bin: string; args: string[]; needsKill: boolean };

async function which(bin: string): Promise<boolean> {
  try {
    const command = new Deno.Command("which", { args: [bin], stdout: "null", stderr: "null" });
    return (await command.output()).success;
  } catch (_) {
    return false;
  }
}

async function findRecorder(): Promise<Recorder | null> {
  if (await which("arecord")) {
    return {
      bin: "arecord",
      args: ["-q", "-f", "S16_LE", "-r", String(SAMPLE_RATE), "-c", "1", "-t", "raw", "-d", String(CHUNK_SECONDS)],
      needsKill: false,
    };
  }
  if (await which("pw-record")) {
    return {
      bin: "pw-record",
      args: ["--rate", String(SAMPLE_RATE), "--channels", "1", "--format", "s16", "-"],
      needsKill: true, // pw-record has no duration flag
    };
  }
  if (await which("ffmpeg")) {
    return {
      bin: "ffmpeg",
      args: [
        "-hide_banner", "-loglevel", "error",
        "-f", "pulse", "-i", "default",
        "-t", String(CHUNK_SECONDS),
        "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "pipe:1",
      ],
      needsKill: false,
    };
  }
  return null;
}

function rmsOfS16(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
  const samples = view.byteLength / 2;
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

function s16ToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
  const samples = view.byteLength / 2;
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

function wavHeader(pcmBytes: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  v.setUint32(4, 36 + pcmBytes, true);
  write(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  write(36, "data");
  v.setUint32(40, pcmBytes, true);
  return new Uint8Array(header);
}

export async function createVoiceInput(callbacks: VoiceCallbacks): Promise<VoiceInput> {
  if (Deno.args.includes("--no-voice-input")) {
    return { available: false, reason: "voice input disabled", start() {}, stop() {} };
  }

  const found = await findRecorder();
  if (!found) {
    return { available: false, reason: "no mic recorder (arecord/pw-record/ffmpeg)", start() {}, stop() {} };
  }
  const recorder: Recorder = found;

  const sttCmd = Deno.args.find((a) => a.startsWith("--stt-cmd="))?.slice(10) ?? "";

  let wanted = false;
  let looping = false;
  let child: Deno.ChildProcess | null = null;
  let worker: Worker | null = null;
  let workerReady = false;
  let workerBusy = false;

  function ensureWorker() {
    if (worker || sttCmd) return;
    worker = new Worker(new URL("./stt_worker.ts", import.meta.url), { type: "module" });
    // a broken model runtime must not take the whole game down — voice just
    // degrades to "type the word"
    worker.onerror = (event) => {
      event.preventDefault();
      workerReady = false;
      workerBusy = false;
      callbacks.onStatus("voice off (model failed to load) — type the word!");
      try {
        worker?.terminate();
      } catch (_) { /* already dead */ }
      worker = null;
    };
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "ready") {
        workerReady = true;
        callbacks.onStatus("listening");
      } else if (message.type === "progress") {
        callbacks.onStatus(`downloading whisper ${message.pct}%`);
      } else if (message.type === "transcript") {
        workerBusy = false;
        if (message.text.trim()) callbacks.onTranscript(message.text);
      } else if (message.type === "error") {
        workerBusy = false;
        workerReady = false;
        callbacks.onStatus(`voice error: ${message.message.slice(0, 60)}`);
      }
    };
    callbacks.onStatus("loading whisper…");
    worker.postMessage({ type: "init" });
  }

  async function recordChunk(): Promise<Uint8Array | null> {
    try {
      const command = new Deno.Command(recorder.bin, {
        args: recorder.args,
        stdout: "piped",
        stderr: "null",
        stdin: "null",
      });
      child = command.spawn();
      if (recorder.needsKill) {
        const current = child;
        setTimeout(() => {
          try {
            current.kill("SIGTERM");
          } catch (_) { /* already gone */ }
        }, CHUNK_SECONDS * 1000);
      }
      const { stdout } = await child.output();
      child = null;
      return stdout.length ? stdout : null;
    } catch (_) {
      child = null;
      return null;
    }
  }

  async function transcribeWithCmd(pcm: Uint8Array): Promise<string> {
    const wavPath = new URL("./.cache/voice-chunk.wav", import.meta.url).pathname;
    await Deno.mkdir(new URL("./.cache/", import.meta.url).pathname, { recursive: true }).catch(() => {});
    const wav = new Uint8Array(44 + pcm.length);
    wav.set(wavHeader(pcm.length));
    wav.set(pcm, 44);
    await Deno.writeFile(wavPath, wav);
    const [bin, ...rest] = sttCmd.split(/\s+/);
    const args = rest.map((a) => a.replaceAll("{wav}", wavPath));
    const command = new Deno.Command(bin, { args, stdout: "piped", stderr: "null", stdin: "null" });
    const { stdout } = await command.output();
    return new TextDecoder().decode(stdout).trim();
  }

  async function loop() {
    if (looping) return;
    looping = true;
    while (wanted) {
      const pcm = await recordChunk();
      if (!wanted) break;
      if (!pcm || pcm.length < SAMPLE_RATE) continue; // < 0.5s of audio: recorder hiccup
      if (rmsOfS16(pcm) < RMS_SILENCE) continue; // silence — don't waste the model

      if (sttCmd) {
        try {
          const text = await transcribeWithCmd(pcm);
          if (text) callbacks.onTranscript(text);
        } catch (_) {
          callbacks.onStatus("voice error: stt command failed");
        }
      } else if (workerReady && !workerBusy && worker) {
        workerBusy = true;
        const audio = s16ToFloat32(pcm);
        const buffer = audio.buffer as ArrayBuffer;
        worker.postMessage({ type: "transcribe", audio: buffer }, [buffer]);
      }
    }
    looping = false;
  }

  return {
    available: true,
    reason: `mic: ${recorder.bin}${sttCmd ? " → " + sttCmd.split(/\s+/)[0] : " → whisper (wasm)"}`,
    start() {
      if (wanted) return;
      wanted = true;
      ensureWorker();
      if (sttCmd) callbacks.onStatus("listening");
      loop();
    },
    stop() {
      wanted = false;
      try {
        child?.kill("SIGTERM");
      } catch (_) { /* already gone */ }
    },
  };
}
