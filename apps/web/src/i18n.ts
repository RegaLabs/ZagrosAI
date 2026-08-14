export const translations = {
  en: {
    appName: "Zagros",
    nav: {
      chats: "Chats",
      agents: "Agents",
      tasks: "Tasks",
      routines: "Routines",
      memory: "Memory",
      skills: "Skills",
      settings: "Settings",
      more: "More",
    },
    actions: {
      send: "Send",
      cancel: "Cancel",
      save: "Save",
      delete: "Delete",
      confirm: "Confirm",
      approve: "Approve",
      reject: "Reject",
      pause: "Pause",
      resume: "Resume",
      stop: "Stop",
      retry: "Retry",
    },
    status: {
      completed: "Completed",
      failed: "Failed",
      running: "Running",
      paused: "Paused",
    },
  },
  ku: {
    appName: "Zagros",
    nav: {
      chats: "گفتوگوکان",
      agents: "ئەجێنتەکان",
      tasks: "ئەرکەکان",
      routines: "ڕووتینەکان",
      memory: "بیرگە",
      skills: "شارەزاییەکان",
      settings: "ڕێکخستنەکان",
      more: "زیاتر",
    },
    actions: {
      send: "ناردن",
      cancel: "پاشگەزبوونەوە",
      save: "پاشەکەوت",
      delete: "سڕینەوە",
      confirm: "دڵنیابوون",
      approve: "پەسەندکردن",
      reject: "ڕەتکردنەوە",
      pause: "وەستان",
      resume: "بەردەوامبوون",
      stop: "وەستان",
      retry: "دووبارە",
    },
    status: {
      completed: "تەواو",
      failed: "سەرنەکەوتوو",
      running: "بەردەوامە",
      paused: "وەستاوە",
    },
  },
} as const;

export type Lang = keyof typeof translations;

type NestedKeys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : NestedKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = NestedKeys<(typeof translations)["en"]>;

export function getLang(): Lang {
  if (
    typeof navigator !== "undefined" &&
    navigator.language.toLowerCase().startsWith("ku")
  ) {
    return "ku";
  }
  return "en";
}

function lookup(node: unknown, parts: string[]): string | null {
  if (parts.length === 0 || typeof node !== "object" || node === null) {
    return null;
  }
  const head = parts[0];
  if (head === undefined) return null;
  const rest = parts.slice(1);
  const value = (node as Record<string, unknown>)[head];
  if (value === undefined) return null;
  if (rest.length === 0) return typeof value === "string" ? value : null;
  return lookup(value, rest);
}

export function t(lang: Lang, key: TranslationKey): string {
  return lookup(translations[lang], key.split(".")) ?? key;
}
