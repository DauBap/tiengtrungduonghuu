import { useSyncExternalStore } from "react";

export type SpeechEngine = "melo" | "local";
export type SpeechStatus = "idle" | "melo" | "local" | "fallback";
export type ThemePreference = "light" | "dark" | "system";

export interface AppSettings {
  showPinyin: boolean;
  speechEngine: SpeechEngine;
  themePreference: ThemePreference;
}

const STORAGE_KEY = "chinese-study-settings";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  showPinyin: true,
  speechEngine: "melo",
  themePreference: "system",
};

let settings = DEFAULT_APP_SETTINGS;
let initialized = false;
const listeners = new Set<() => void>();
const speechListeners = new Set<() => void>();
let speechStatus: SpeechStatus = "idle";

function parseSettings(raw: string | null): AppSettings {
  if (!raw) return DEFAULT_APP_SETTINGS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_APP_SETTINGS;
    const saved = value as Partial<AppSettings>;
    return {
      showPinyin: typeof saved.showPinyin === "boolean" ? saved.showPinyin : true,
      speechEngine: saved.speechEngine === "local" ? "local" : "melo",
      themePreference: saved.themePreference === "light" || saved.themePreference === "dark"
        ? saved.themePreference
        : "system",
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function notifySpeechStatus() {
  speechListeners.forEach((listener) => listener());
}

function applyThemePreference() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const isDark = settings.themePreference === "dark"
    || (settings.themePreference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

function onSystemThemeChange() {
  if (settings.themePreference === "system") applyThemePreference();
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  settings = parseSettings(event.key === null ? null : event.newValue);
  speechStatus = settings.speechEngine === "local" ? "local" : "idle";
  applyThemePreference();
  initialized = true;
  notify();
  notifySpeechStatus();
}

export function initializeAppSettings() {
  if (typeof window === "undefined" || initialized) return;
  try {
    settings = parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    settings = DEFAULT_APP_SETTINGS;
  }
  initialized = true;
  window.addEventListener("storage", onStorage);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onSystemThemeChange);
  applyThemePreference();
  notify();
}

export function getAppSettings(): AppSettings {
  return settings;
}

export function updateAppSetting<Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) {
  initializeAppSettings();
  settings = { ...settings, [key]: value };
  if (key === "themePreference") applyThemePreference();
  if (key === "speechEngine") {
    speechStatus = value === "local" ? "local" : "idle";
    notifySpeechStatus();
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Keep the in-memory setting active when storage is unavailable.
  }
  notify();
}

export function subscribeAppSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppSettings() {
  return useSyncExternalStore(subscribeAppSettings, getAppSettings, () => DEFAULT_APP_SETTINGS);
}

export function getSpeechStatus(): SpeechStatus {
  return speechStatus;
}

export function setSpeechStatus(status: SpeechStatus) {
  if (speechStatus === status) return;
  speechStatus = status;
  notifySpeechStatus();
}

export function subscribeSpeechStatus(listener: () => void) {
  speechListeners.add(listener);
  return () => speechListeners.delete(listener);
}

export function useSpeechStatus() {
  return useSyncExternalStore(subscribeSpeechStatus, getSpeechStatus, () => "idle");
}