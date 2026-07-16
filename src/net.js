// Optional PeerCompute integration: joins a "hackerbaby" room via NodeKernel
// and publishes game status through the shared StateManager, so a parent on
// another device (or NetViz) can watch progress. Everything degrades
// silently when no relay is reachable — the games never depend on it.

let kernel = null;
let stateManager = null;
let peerId = null;
let lastStatus = {};

const NAMESPACE = 'hackerbaby';

async function tryFetch(path) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch (_) {
    // ignore
  }
  return null;
}

async function loadRelayConfig() {
  const params = new URLSearchParams(window.location.search);
  const overrideUrl = params.get('relayConfigUrl') || params.get('relayConfig') || '';
  if (overrideUrl) {
    const remote = await tryFetch(overrideUrl);
    if (remote) return remote;
  }
  return (
    (await tryFetch('./relay-config.json')) ||
    (await tryFetch('/relay-config.json')) ||
    { bootstrapPeers: [] }
  );
}

export async function initNet({ onStatus } = {}) {
  try {
    const { NodeKernel } = await import('@peercompute');
    const cfg = await loadRelayConfig();
    const bootstrapPeers = Array.isArray(cfg.bootstrapPeers) ? cfg.bootstrapPeers.filter(Boolean) : [];

    kernel = new NodeKernel({
      bootstrapPeers,
      enablePersistence: false,
      gameId: 'hackerbaby',
      roomId: 'nursery'
    });
    await kernel.initialize();
    await kernel.start();
    stateManager = kernel.getStateManager();
    peerId = kernel.getStatus().network.peerId;

    publishStatus(lastStatus);

    if (onStatus) {
      const report = () => {
        try {
          const count = kernel?.getStatus?.().network?.peerCount || 0;
          onStatus(`PeerCompute: connected as ${String(peerId).slice(-8)} · ${count} peer(s)`);
        } catch (_) {
          // kernel shutting down
        }
      };
      report();
      setInterval(report, 10000);
    }

    window.addEventListener('beforeunload', () => {
      try {
        stateManager?.deleteScoped(NAMESPACE, `status-${peerId}`);
      } catch (_) {
        // best effort
      }
    });
  } catch (err) {
    console.warn('PeerCompute unavailable (offline is fine):', err);
    onStatus?.('PeerCompute: offline (no relay reachable)');
  }
}

export function publishStatus(status) {
  lastStatus = { ...lastStatus, ...status, updatedAt: Date.now() };
  if (!stateManager || !peerId) return;
  try {
    stateManager.writeScoped(NAMESPACE, `status-${peerId}`, lastStatus);
  } catch (err) {
    console.warn('status publish failed', err);
  }
}
