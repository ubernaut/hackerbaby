// Webcam discovery. Deno guards /dev behind --allow-all (device nodes are
// side-effectful), so instead of enumerating the directory we probe the
// usual candidate nodes with a real one-frame ffmpeg capture — the child
// process isn't subject to the Deno sandbox, and a successful probe also
// proves the node can actually deliver frames (kernels expose several
// nodes per camera, including metadata-only ones).

export interface CameraProbe {
  device: string | null;
  reason: string;
}

const CANDIDATES = Array.from({ length: 8 }, (_, i) => `/dev/video${i}`);

// USB cameras can take several seconds to negotiate before the first frame,
// and hard-killing ffmpeg mid-stream can wedge UVC firmware until the camera
// is replugged — so probes get real headroom and a gentle SIGTERM first,
// with SIGKILL only as a last resort.
async function probeDevice(device: string, timeoutMs = 9000): Promise<{ ok: boolean; stderr: string }> {
  try {
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-hide_banner",
        "-loglevel", "error",
        "-f", "v4l2",
        "-i", device,
        "-frames:v", "1",
        "-f", "null",
        "-",
      ],
      stdout: "null",
      stderr: "piped",
      stdin: "null",
    });
    const child = command.spawn();
    const term = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch (_) { /* already exited */ }
    }, timeoutMs);
    const kill = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) { /* already exited */ }
    }, timeoutMs + 2000);
    const { success, stderr } = await child.output();
    clearTimeout(term);
    clearTimeout(kill);
    return { ok: success, stderr: new TextDecoder().decode(stderr) };
  } catch (_) {
    return { ok: false, stderr: "probe failed to spawn" };
  }
}

let cachedDevice: string | null | undefined;

/** Find a camera device that can actually deliver frames. */
export async function findCamera(): Promise<CameraProbe> {
  const override = Deno.args.find((a) => a.startsWith("--camera="))?.slice(9);
  // synthetic test source (ffmpeg lavfi) — exercises the whole pipeline
  // without touching camera hardware
  if (override === "testsrc") return { device: "testsrc", reason: "synthetic test pattern" };

  // probing opens the device; do it once per session so re-entering the
  // mirror doesn't stress UVC firmware with open/close cycles
  if (cachedDevice !== undefined) {
    return cachedDevice
      ? { device: cachedDevice, reason: `probed earlier: ${cachedDevice}` }
      : { device: null, reason: "no camera found earlier this session" };
  }

  try {
    const which = new Deno.Command("which", { args: ["ffmpeg"], stdout: "null", stderr: "null" });
    if (!(await which.output()).success) {
      return { device: null, reason: "ffmpeg not installed" };
    }
  } catch (_) {
    return { device: null, reason: "cannot check for ffmpeg" };
  }

  const candidates = override ? [override] : CANDIDATES;
  let sawPermissionDenied = false;
  let sawDevice = false;

  let sawBusy = false;
  for (const device of candidates) {
    const { ok, stderr } = await probeDevice(device);
    if (ok) {
      cachedDevice = device;
      // let the device settle after the probe's open/close before streaming
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { device, reason: `probed ${device}` };
    }
    if (/no such file/i.test(stderr)) continue; // node doesn't exist — keep looking
    sawDevice = true;
    if (/permission denied/i.test(stderr)) sawPermissionDenied = true;
    if (/busy|protocol error/i.test(stderr)) sawBusy = true;
  }

  cachedDevice = null;
  if (sawPermissionDenied) {
    return { device: null, reason: "camera permission denied — add your user to the `video` group" };
  }
  if (sawBusy) {
    return { device: null, reason: "camera busy or wedged — close other apps or replug it" };
  }
  if (sawDevice) {
    return { device: null, reason: "camera found but not capturable" };
  }
  return { device: null, reason: "no camera found" };
}
