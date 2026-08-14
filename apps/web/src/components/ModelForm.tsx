import { useState } from "react";
import type { ChangeEvent } from "react";
import type { ModelConfig, ModelDriver, ModelFallbackConfig } from "../types.js";
import { IconPlus, IconTrash } from "./Icons.js";

interface Props {
  value: ModelConfig;
  onChange: (next: ModelConfig) => void;
}

interface DriverOption {
  value: ModelDriver;
  label: string;
}

const DRIVER_OPTIONS: DriverOption[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google (Gemini)" },
  { value: "xai", label: "xAI (Grok)" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "cloudflare", label: "Cloudflare Workers AI" },
  { value: "ollama", label: "Ollama" },
  { value: "vllm", label: "vLLM" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "acp", label: "ACP harness" },
];

const BASE_URL_PRESETS: Partial<Record<ModelDriver, string>> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  vllm: "http://localhost:8000/v1",
  lmstudio: "http://localhost:1234/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com/v1",
};

interface FallbackRowProps {
  index: number;
  entry: ModelFallbackConfig;
  onChange: (next: ModelFallbackConfig) => void;
  onRemove: () => void;
}

function FallbackRow({ index, entry, onChange, onRemove }: FallbackRowProps) {
  return (
    <div className="fallback-row">
      <div className="field">
        <label htmlFor={`fallback-driver-${index}`}>Driver</label>
        <select
          id={`fallback-driver-${index}`}
          value={entry.driver}
          onChange={(e) => onChange({ ...entry, driver: e.target.value as ModelDriver })}
        >
          {DRIVER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`fallback-model-${index}`}>Model</label>
        <input
          id={`fallback-model-${index}`}
          value={entry.model}
          placeholder="gpt-4o-mini"
          onChange={(e) => onChange({ ...entry, model: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`fallback-base-url-${index}`}>Base URL</label>
        <input
          id={`fallback-base-url-${index}`}
          value={entry.baseUrl ?? ""}
          placeholder="https://api.example.com/v1"
          onChange={(e) => onChange({ ...entry, baseUrl: e.target.value || undefined })}
        />
      </div>
      <div className="field">
        <label htmlFor={`fallback-api-key-${index}`}>API key</label>
        <input
          id={`fallback-api-key-${index}`}
          type="password"
          value={entry.apiKey ?? ""}
          placeholder="sk-…"
          onChange={(e) => onChange({ ...entry, apiKey: e.target.value || undefined })}
        />
      </div>
      <button
        className="icon-btn"
        type="button"
        aria-label={`Remove fallback ${index + 1}`}
        onClick={onRemove}
      >
        <IconTrash size={15} />
      </button>
    </div>
  );
}

export function ModelForm({ value, onChange }: Props) {
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);

  const patch = (next: Partial<ModelConfig>) => onChange({ ...value, ...next });

  const changeDriver = (e: ChangeEvent<HTMLSelectElement>) => {
    const driver = e.target.value as ModelDriver;
    if (baseUrlTouched) {
      patch({ driver });
      return;
    }
    patch({ driver, baseUrl: BASE_URL_PRESETS[driver] });
  };

  const fallbacks = value.fallback ?? [];

  const patchFallback = (index: number, next: ModelFallbackConfig) => {
    const list = [...fallbacks];
    list[index] = next;
    patch({ fallback: list });
  };

  const removeFallback = (index: number) => {
    const list = [...fallbacks];
    list.splice(index, 1);
    patch({ fallback: list.length > 0 ? list : undefined });
  };

  const addFallback = () => {
    patch({ fallback: [...fallbacks, { driver: "openai", model: "" }] });
  };

  const driverHint = BASE_URL_PRESETS[value.driver];

  return (
    <div className="model-form">
      <div className="field-row">
        <div className="field">
          <label htmlFor="model-driver">Driver</label>
          <select id="model-driver" value={value.driver} onChange={changeDriver}>
            {DRIVER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="model-name">Model</label>
          <input
            id="model-name"
            value={value.model}
            placeholder="gpt-4o-mini"
            onChange={(e) => patch({ model: e.target.value })}
          />
        </div>
      </div>
      {driverHint && <p className="model-hint">Default base URL: {driverHint}</p>}
      {value.driver === "openai-compatible" && (
        <p className="model-hint">A base URL is required for OpenAI-compatible providers.</p>
      )}
      {value.driver !== "acp" && (
        <>
          <div className="field">
            <label htmlFor="model-base-url">Base URL</label>
            <input
              id="model-base-url"
              value={value.baseUrl ?? ""}
              placeholder="https://api.example.com/v1"
              onChange={(e) => {
                setBaseUrlTouched(true);
                patch({ baseUrl: e.target.value || undefined });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="model-api-key">API key</label>
            <input
              id="model-api-key"
              type="password"
              value={value.apiKey ?? ""}
              placeholder="sk-…"
              onChange={(e) => patch({ apiKey: e.target.value || undefined })}
            />
          </div>
        </>
      )}
      {value.driver === "acp" && (
        <>
          <div className="field">
            <label htmlFor="model-harness">Provider harness (ACP)</label>
            <input
              id="model-harness"
              value={value.harness ?? ""}
              placeholder="codex, claude-code, gemini-cli, or custom"
              onChange={(e) => patch({ harness: e.target.value || undefined })}
            />
          </div>
          <p className="model-hint">
            Runs on an Zagros Runner that has the harness installed. The provider CLI keeps its
            own login.
          </p>
        </>
      )}
      <div className="field">
        <label htmlFor="model-temperature">
          Temperature <span className="field-value">{value.temperature.toFixed(1)}</span>
        </label>
        <input
          id="model-temperature"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={value.temperature}
          onChange={(e) => patch({ temperature: Number(e.target.value) })}
        />
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={value.imageInput}
          onChange={(e) => patch({ imageInput: e.target.checked })}
        />
        <span>Accept image input</span>
      </label>
      <details className="fallbacks">
        <summary>Model fallbacks{fallbacks.length > 0 ? ` (${fallbacks.length})` : ""}</summary>
        {fallbacks.map((entry, index) => (
          <FallbackRow
            key={index}
            index={index}
            entry={entry}
            onChange={(next) => patchFallback(index, next)}
            onRemove={() => removeFallback(index)}
          />
        ))}
        <button className="btn btn-sm" type="button" onClick={addFallback}>
          <IconPlus size={14} />
          Add fallback
        </button>
      </details>
    </div>
  );
}
