export type PushState =
  | "unsupported"
  | "not-configured"
  | "permission-denied"
  | "subscribed"
  | "idle";

export interface PushResult {
  ok: boolean;
  endpoint?: string;
  reason?: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function vapidKey(): string | undefined {
  return import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
}

export async function subscribeToPush(): Promise<PushResult> {
  if (!("serviceWorker" in navigator)) {
    return { ok: false, reason: "push-unsupported" };
  }
  const vapidPublicKey = vapidKey();
  if (!vapidPublicKey) {
    return { ok: false, reason: "vapid-not-configured" };
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: arrayBufferToBase64(subscription.getKey("p256dh")),
        auth: arrayBufferToBase64(subscription.getKey("auth")),
      },
    }),
  });
  if (!response.ok) {
    return { ok: false, reason: `subscribe-failed-${response.status}` };
  }
  return { ok: true, endpoint: subscription.endpoint };
}

export async function unsubscribeFromPush(): Promise<PushResult> {
  if (!("serviceWorker" in navigator)) {
    return { ok: false, reason: "push-unsupported" };
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return { ok: true };
  }
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  return { ok: true };
}

export async function getPushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "permission-denied";
  }
  if (!vapidKey()) {
    return "not-configured";
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? "subscribed" : "idle";
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}
