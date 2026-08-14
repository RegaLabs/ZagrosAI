import { useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { SkillTestResult, SkillSummary } from "../types.js";
import { IconPlus, IconSkills } from "./Icons.js";

function SkillCard({
  skill,
  expanded,
  readme,
  readmeLoading,
  testResults,
  testing,
  onToggleReadme,
  onTest,
  onRemove,
}: {
  skill: SkillSummary;
  expanded: boolean;
  readme?: string;
  readmeLoading: boolean;
  testResults?: SkillTestResult[];
  testing: boolean;
  onToggleReadme: () => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="skill-card glass">
      <div className="skill-card-top">
        <span className="skill-name">{skill.name}</span>
        <span className="skill-version">v{skill.version}</span>
        <span className="skill-tests-count">
          {skill.tests.length} {skill.tests.length === 1 ? "test" : "tests"}
        </span>
      </div>
      <p className="skill-desc">{skill.description}</p>
      <div className="chip-row">
        {skill.requires.tools.map((tool) => (
          <span key={`tool-${tool}`} className="chip">
            {tool}
          </span>
        ))}
        {skill.requires.capabilities.map((capability) => (
          <span key={`cap-${capability}`} className="chip">
            {capability}
          </span>
        ))}
        {skill.tags.map((tag) => (
          <span key={`tag-${tag}`} className="chip">
            {tag}
          </span>
        ))}
      </div>
      <div className="skill-actions">
        <button className="btn btn-sm" onClick={onToggleReadme}>
          {expanded ? "Hide" : "View"}
        </button>
        <button
          className="btn btn-sm"
          onClick={onTest}
          disabled={testing || readmeLoading}
        >
          {testing ? "Testing…" : "Test"}
        </button>
        <button className="btn btn-sm btn-danger" onClick={onRemove}>
          Remove
        </button>
      </div>
      {expanded && (
        <div className="skill-readme">
          {readmeLoading && readme === undefined ? (
            <span className="skill-readme-loading">Loading readme…</span>
          ) : (
            <pre>{readme ?? ""}</pre>
          )}
        </div>
      )}
      {testResults && (
        <ul className="test-results">
          {testResults.map((result) => (
            <li key={result.test} className="test-result">
              <div className="test-result-head">
                <span
                  className={`badge ${
                    result.ok ? "test-result-ok" : "test-result-fail"
                  }`}
                >
                  {result.ok ? "ok" : "fail"}
                </span>
                <span className="test-result-name">{result.test}</span>
              </div>
              {result.output && <pre className="test-output">{result.output}</pre>}
              {result.error && <pre className="test-error">{result.error}</pre>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function SkillsView() {
  const skills = useStore((s) => s.skills);
  const skillsSupported = useStore((s) => s.skillsSupported);
  const installSkill = useStore((s) => s.installSkill);
  const removeSkill = useStore((s) => s.removeSkill);
  const runSkillTests = useStore((s) => s.runSkillTests);

  const [source, setSource] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [readmes, setReadmes] = useState<Record<string, string>>({});
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, SkillTestResult[]>
  >({});

  const install = async () => {
    const src = source.trim();
    if (!src) return;
    setInstalling(true);
    setError(null);
    try {
      await installSkill(src);
      setSource("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "install failed");
    } finally {
      setInstalling(false);
    }
  };

  const toggleReadme = async (name: string) => {
    if (expandedName === name) {
      setExpandedName(null);
      return;
    }
    setExpandedName(name);
    if (readmes[name] !== undefined) return;
    setReadmeLoading(true);
    setError(null);
    try {
      const detail = await api.skillDetail(name);
      setReadmes((prev) => ({ ...prev, [name]: detail.readme }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "readme load failed");
    } finally {
      setReadmeLoading(false);
    }
  };

  const test = async (name: string) => {
    setTestingName(name);
    setError(null);
    try {
      const results = await runSkillTests(name);
      setTestResults((prev) => ({ ...prev, [name]: results }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "test failed");
    } finally {
      setTestingName(null);
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Remove skill ${name}?`)) return;
    setError(null);
    try {
      await removeSkill(name);
      setExpandedName(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "remove failed");
    }
  };

  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">Skills</h2>
      </header>

      <section className="memory-form glass">
        <div className="install-row">
          <input
            className="install-input"
            type="text"
            placeholder="github:owner/repo or git:URL"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <button
            className="btn btn-accent"
            onClick={() => void install()}
            disabled={!skillsSupported || installing || !source.trim()}
          >
            <IconPlus size={16} />
            Install
          </button>
        </div>
        {!skillsSupported && (
          <p className="skill-note">
            Skill installs require the local filesystem runtime — skills are
            loaded from the control plane filesystem, and the Cloudflare
            runtime does not support them yet.
          </p>
        )}
        {error && <p className="memory-error">{error}</p>}
      </section>

      {skills.length === 0 ? (
        <div className="empty">
          <IconSkills size={36} />
          <p>
            No skills yet — install one from a GitHub repository or git URL.
          </p>
        </div>
      ) : (
        <ul className="skills-grid">
          {skills.map((skill) => (
            <SkillCard
              key={skill.name}
              skill={skill}
              expanded={expandedName === skill.name}
              readme={readmes[skill.name]}
              readmeLoading={readmeLoading}
              testResults={testResults[skill.name]}
              testing={testingName === skill.name}
              onToggleReadme={() => void toggleReadme(skill.name)}
              onTest={() => void test(skill.name)}
              onRemove={() => void remove(skill.name)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
