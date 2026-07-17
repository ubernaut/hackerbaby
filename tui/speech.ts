// Text-to-speech for the terminal: shells out to whichever TTS binary the
// system has (espeak-ng, espeak, spd-say, macOS say). Fire-and-forget, with
// each new phrase interrupting the previous one. Silently does nothing when
// no engine is installed or --no-voice was passed.

type Engine = { bin: string; args: (text: string) => string[] };

const ENGINES: Engine[] = [
  { bin: "espeak-ng", args: (t) => ["-s", "150", "-p", "60", t] },
  { bin: "espeak", args: (t) => ["-s", "150", "-p", "60", t] },
  { bin: "spd-say", args: (t) => ["-r", "-10", "-t", "female1", t] },
  { bin: "say", args: (t) => [t] },
];

async function findEngine(): Promise<Engine | null> {
  for (const engine of ENGINES) {
    try {
      const which = new Deno.Command("which", {
        args: [engine.bin],
        stdout: "null",
        stderr: "null",
      });
      const { success } = await which.output();
      if (success) return engine;
    } catch (_) {
      // `which` unavailable or blocked — keep trying
    }
  }
  return null;
}

export async function createSpeaker(enabled: boolean) {
  const engine = enabled ? await findEngine() : null;
  let child: Deno.ChildProcess | null = null;

  return {
    available: engine !== null,
    engine: engine?.bin ?? null,
    speak(text: string) {
      if (!engine) return;
      try {
        child?.kill("SIGKILL");
      } catch (_) {
        // already exited
      }
      try {
        const command = new Deno.Command(engine.bin, {
          args: engine.args(text),
          stdout: "null",
          stderr: "null",
          stdin: "null",
        });
        child = command.spawn();
        child.status.catch(() => {});
      } catch (_) {
        child = null;
      }
    },
  };
}
