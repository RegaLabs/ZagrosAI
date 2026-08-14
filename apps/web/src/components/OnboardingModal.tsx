import { useState } from "react";
import {
  IconBot,
  IconCheck,
  IconChevron,
  IconClock,
  IconCpu,
  IconShield,
  IconTerminal,
  IconX,
} from "./Icons.js";
import { useStore } from "../store.js";
import type { ModelDriver } from "../types.js";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AgentTemplate {
  id: string;
  name: string;
  role: string;
  icon: string;
  description: string;
  systemPrompt: string;
}

const STARTER_TEMPLATES: AgentTemplate[] = [
  {
    id: "coder",
    name: "Zagros Engineer",
    role: "Full-Stack Software Engineer",
    icon: "💻",
    description: "Executes terminal commands, edits local files, inspects bugs, and verifies tests.",
    systemPrompt:
      "You are Zagros Engineer, an autonomous full-stack software engineer. You analyze codebases, propose clean edits, run terminal commands to test changes, and report verified outcomes.",
  },
  {
    id: "researcher",
    name: "Zagros Researcher",
    role: "Deep Research Specialist",
    icon: "🔍",
    description: "Searches web sources, extracts structured data, summarizes documents, and maintains memory.",
    systemPrompt:
      "You are Zagros Researcher, an autonomous research intelligence specialist. You synthesize multi-source data, summarize findings with rigorous citations, and extract durable semantic memory.",
  },
  {
    id: "browser",
    name: "Zagros Web Agent",
    role: "Browser Automation & QA",
    icon: "🌐",
    description: "Navigates websites with Playwright, captures screenshots, inspects UI, and fills forms.",
    systemPrompt:
      "You are Zagros Web Agent, an autonomous browser controller. You inspect web pages, navigate flows, take visual screenshots, and automate web tasks reliably.",
  },
  {
    id: "general",
    name: "Zagros Assistant",
    role: "General Task Orchestrator",
    icon: "🦅",
    description: "Coordinates multi-step workflows, manages routines, plans subtasks, and retains long-term memory.",
    systemPrompt:
      "You are Zagros Assistant, a durable agent operating system assistant. You help users plan complex goals, delegate to specialized subagents, manage scheduled routines, and achieve outcomes.",
  },
];

export function OnboardingModal({ isOpen, onClose }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("coder");
  const [selectedProvider, setSelectedProvider] = useState<ModelDriver>("openai-compatible");
  const [apiKey, setApiKey] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAgent = useStore((s) => s.createAgent);
  const createConversation = useStore((s) => s.createConversation);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const loadConversation = useStore((s) => s.loadConversation);
  const updateSettings = useStore((s) => s.updateSettings);
  const settings = useStore((s) => s.settings);

  if (!isOpen) return null;

  const totalSteps = 4;

  const handleNext = () => {
    setError(null);
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      void handleFinish();
    }
  };

  const handleBack = () => {
    setError(null);
    if (step > 0) setStep(step - 1);
  };

  const handleFinish = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const template = STARTER_TEMPLATES.find((t) => t.id === selectedTemplate) ?? STARTER_TEMPLATES[0]!;

      const modelName =
        selectedProvider === "anthropic"
          ? "claude-3-7-sonnet"
          : selectedProvider === "google"
          ? "gemini-2.0-flash"
          : selectedProvider === "ollama"
          ? "qwen2.5-coder:7b"
          : "gpt-4o";

      const defaultModel = {
        driver: selectedProvider,
        model: modelName,
        apiKey: apiKey.trim() || undefined,
        temperature: 0.7,
        imageInput: true,
      };

      if (settings) {
        await updateSettings({
          defaultModel,
        });
      }

      const agent = await createAgent({
        name: template.name,
        systemPrompt: template.systemPrompt,
        model: defaultModel,
      });

      if (agent?.id) {
        const convo = await createConversation(agent.id);
        if (convo?.id) {
          setActiveConversation(convo.id);
          setActiveTab("chats");
          void loadConversation(convo.id).catch(() => {});
        }
      }
      localStorage.setItem("zagros_onboarded", "true");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete agent setup");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem("zagros_onboarded", "true");
    onClose();
  };

  return (
    <div className="modal-backdrop glass-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="modal glass onboarding-modal">
        {/* Header Bar */}
        <div className="onboarding-header">
          <div className="onboarding-progress-dots">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <button
                key={i}
                type="button"
                className={`progress-dot ${i === step ? "active" : ""} ${i < step ? "completed" : ""}`}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
          <button type="button" className="icon-btn close-btn" onClick={handleSkip} aria-label="Skip onboarding">
            <IconX size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="onboarding-body">
          {step === 0 && (
            <div className="onboarding-step step-welcome">
              <div className="onboarding-brand-hero">
                <div className="onboarding-logo-wrapper">
                  <img src="/Zagros.png" alt="Zagros" className="onboarding-logo-img" />
                </div>
                <h2 id="onboarding-title" className="onboarding-title">
                  Welcome to <span className="gold-gradient-text">Zagros</span>
                </h2>
                <p className="onboarding-subtitle">
                  The open-source operating system for persistent AI agents that keep working across your machines and the cloud.
                </p>
              </div>

              <div className="onboarding-pillars-grid">
                <div className="pillar-card glass-panel">
                  <div className="pillar-icon"><IconBot size={20} /></div>
                  <div className="pillar-text">
                    <h4>Persistent & Durable</h4>
                    <p>Close your laptop. Tasks survive network outages, browser refreshes, and server restarts.</p>
                  </div>
                </div>

                <div className="pillar-card glass-panel">
                  <div className="pillar-icon"><IconCpu size={20} /></div>
                  <div className="pillar-text">
                    <h4>Model & Tool Neutral</h4>
                    <p>Use OpenAI, Claude, Gemini, Grok, Ollama, custom MCP tools, and provider ACP harnesses.</p>
                  </div>
                </div>

                <div className="pillar-card glass-panel">
                  <div className="pillar-icon"><IconTerminal size={20} /></div>
                  <div className="pillar-text">
                    <h4>Hybrid Execution Fabric</h4>
                    <p>Serverless cloud control plane paired with local Runners for shell, files, and browsers.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-step step-providers">
              <div className="step-heading">
                <h3>Choose Your Intelligence Provider</h3>
                <p>Select your preferred model driver. You can configure multiple models and fallback chains anytime.</p>
              </div>

              <div className="provider-selection-grid">
                {[
                  { id: "openai-compatible" as ModelDriver, name: "OpenAI / Compatible", desc: "GPT-4o, Grok (xAI), OpenRouter, vLLM, LM Studio", icon: "⚡" },
                  { id: "anthropic" as ModelDriver, name: "Anthropic Claude", desc: "Claude 3.7 Sonnet, Claude 3.5 Haiku, Claude Opus", icon: "🧠" },
                  { id: "google" as ModelDriver, name: "Google Gemini", desc: "Gemini 2.0 Flash, Gemini 1.5 Pro with large context", icon: "✨" },
                  { id: "ollama" as ModelDriver, name: "Local Ollama", desc: "Private on-device inference (Qwen, Llama 3, DeepSeek)", icon: "🦙" },
                  { id: "cloudflare" as ModelDriver, name: "Cloudflare Workers AI", desc: "Zero-VPS serverless inference on Cloudflare edge", icon: "☁️" },
                ].map((p) => (
                  <div
                    key={p.id}
                    className={`provider-card glass-panel ${selectedProvider === p.id ? "selected" : ""}`}
                    onClick={() => setSelectedProvider(p.id)}
                  >
                    <span className="provider-emoji">{p.icon}</span>
                    <div className="provider-meta">
                      <strong>{p.name}</strong>
                      <span>{p.desc}</span>
                    </div>
                    {selectedProvider === p.id && (
                      <span className="selected-check"><IconCheck size={16} /></span>
                    )}
                  </div>
                ))}
              </div>

              {selectedProvider !== "ollama" && selectedProvider !== "cloudflare" && (
                <div className="api-key-input-box glass-panel">
                  <label htmlFor="onboarding-api-key">
                    <IconShield size={14} /> Optional API Key (Encrypted at Rest with AES-256-GCM)
                  </label>
                  <input
                    id="onboarding-api-key"
                    type="password"
                    placeholder={`Enter ${selectedProvider} API key (or configure later in Settings)`}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="glass-input"
                  />
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-step step-runners">
              <div className="step-heading">
                <h3>Execution Fabric & Runners</h3>
                <p>Connect machines to give your agents access to local terminals, file workspaces, and Playwright browsers.</p>
              </div>

              <div className="runner-concept-box glass-panel">
                <div className="runner-flow-diagram">
                  <div className="flow-node">
                    <span className="node-icon">📱</span>
                    <span className="node-label">Phone / Web UI</span>
                  </div>
                  <span className="flow-arrow">➔</span>
                  <div className="flow-node highlighted">
                    <span className="node-icon">🦅</span>
                    <span className="node-label">Zagros Control Plane</span>
                  </div>
                  <span className="flow-arrow">➔</span>
                  <div className="flow-node">
                    <span className="node-icon">💻</span>
                    <span className="node-label">Local Runner</span>
                  </div>
                </div>

                <div className="runner-command-snippet">
                  <div className="snippet-header">
                    <span>Start a Runner on your machine</span>
                  </div>
                  <pre className="code-block"><code>pnpm dev:runner</code></pre>
                </div>

                <p className="runner-help-text">
                  The Runner connects outbound securely via WebSocket. No public IP, port forwarding, or firewall opening is required.
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-step step-templates">
              <div className="step-heading">
                <h3>Launch Your First Autonomous Agent</h3>
                <p>Select a starter specialist to configure your first persistent agent workspace.</p>
              </div>

              <div className="templates-grid">
                {STARTER_TEMPLATES.map((tmpl) => (
                  <div
                    key={tmpl.id}
                    className={`template-card glass-panel ${selectedTemplate === tmpl.id ? "selected" : ""}`}
                    onClick={() => setSelectedTemplate(tmpl.id)}
                  >
                    <div className="template-card-header">
                      <span className="template-emoji">{tmpl.icon}</span>
                      <div className="template-titles">
                        <strong>{tmpl.name}</strong>
                        <span className="template-role">{tmpl.role}</span>
                      </div>
                      {selectedTemplate === tmpl.id && (
                        <span className="selected-check"><IconCheck size={16} /></span>
                      )}
                    </div>
                    <p className="template-desc">{tmpl.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="onboarding-footer">
          {error && <p className="form-error onboarding-error">{error}</p>}
          {step > 0 ? (
            <button type="button" className="btn btn-secondary glass-btn" onClick={handleBack} disabled={isCreating}>
              Back
            </button>
          ) : (
            <button type="button" className="btn btn-secondary glass-btn" onClick={handleSkip}>
              Skip Setup
            </button>
          )}

          <div className="footer-right">
            {step < totalSteps - 1 ? (
              <button type="button" className="btn btn-primary glass-primary-btn" onClick={handleNext}>
                Continue <IconChevron size={16} />
              </button>
            ) : (
              <button type="button" className="btn btn-primary glass-primary-btn" onClick={handleFinish} disabled={isCreating}>
                {isCreating ? "Initializing Agent…" : "Launch Zagros 🚀"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
