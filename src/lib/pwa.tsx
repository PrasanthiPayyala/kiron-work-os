// PWA install + update + connectivity helpers.
//
// - usePwaInstall(): captures the `beforeinstallprompt` event and exposes a
//   stable `install()` to fire the native UI. Returns null when the browser
//   has no installable banner (e.g. iOS Safari → user installs via Share).
// - useServiceWorkerUpdate(): registers the SW (built by vite-plugin-pwa)
//   and exposes a `needRefresh` flag + `update()` to apply waiting workers.
// - useOnlineStatus(): subscribes to navigator.onLine + the browser's
//   online/offline events so the rest of the app can render an indicator.

import { useEffect, useState, useCallback } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(display-mode: standalone)").matches,
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setDeferred(null);
    return outcome;
  }, [deferred]);

  return { canInstall: !!deferred && !installed, installed, install };
}

export function useOnlineStatus() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

// Service-worker registration is driven by vite-plugin-pwa's virtual module.
// We dynamically import so non-PWA builds (unit tests) don't fail.
export function useServiceWorkerUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import(/* @vite-ignore */ "virtual:pwa-register");
        if (cancelled) return;
        const updateSW = (mod as { registerSW: (opts: {
          onNeedRefresh?: () => void;
          onOfflineReady?: () => void;
        }) => (reload?: boolean) => Promise<void> }).registerSW({
          onNeedRefresh: () => setNeedRefresh(true),
        });
        setUpdate(() => async () => { await updateSW(true); });
      } catch {
        // virtual:pwa-register only exists when the plugin is active.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { needRefresh, update };
}
