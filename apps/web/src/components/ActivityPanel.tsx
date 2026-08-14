import { useEffect, useState } from "react";
import { formatBytes } from "../format.js";
import { LIVE_TASK_STATUSES, useStore } from "../store.js";
import type { ActivityTab } from "../store.js";
import type { FilesEntry, Task, TaskStep } from "../types.js";
import {
  IconBack,
  IconCamera,
  IconChevron,
  IconComputer,
  IconDot,
  IconFile,
  IconFolder,
  IconPause,
  IconPlay,
  IconRefresh,
  IconTerminal,
} from "./Icons.js";
import { statusLabel, TaskCard } from "./TaskCard.js";

interface Props {
  conversationId: string;
}

interface ShellBlock {
  command: string;
  stdout: string;
  stderr: string;
}

const TABS: { id: ActivityTab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "browser", label: "Browser" },
  { id: "terminal", label: "Terminal" },
  { id: "files", label: "Files" },
];

function newestTask(tasks: Task[], conversationId: string): Task | null {
  const matches = tasks.filter((t) => t.conversationId === conversationId);
  if (matches.length === 0) return null;
  return (
    [...matches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

function stepResultText(step: TaskStep, key: string): string {
  const result = step.result;
  if (typeof result === "string" && key === "stdout") return result;
  if (typeof result !== "object" || result === null) return "";
  const value = (result as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (value !== undefined && value !== null) return String(value);
  return "";
}

function truncate(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function lastBrowserShot(task: Task | null): string | null {
  if (!task) return null;
  for (const step of [...task.steps].reverse()) {
    if (step.kind !== "tool" || step.toolId !== "browser.screenshot") continue;
    const result = step.result;
    if (typeof result !== "object" || result === null) continue;
    const image = (result as Record<string, unknown>).imageBase64;
    if (typeof image === "string" && image.length > 0) return image;
  }
  return null;
}

function toDataUri(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

function joinPath(base: string, name: string): string {
  if (base === "" || base === ".") return name;
  return base.endsWith("/") ? base + name : `${base}/${name}`;
}

function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "." || trimmed === "/") return ".";
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) return ".";
  return trimmed.slice(0, index);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}

function shellBlocks(tasks: Task[], conversationId: string): ShellBlock[] {
  const blocks: ShellBlock[] = [];
  const sorted = tasks
    .filter((t) => t.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const task of sorted) {
    if (blocks.length >= 6) break;
    for (const step of [...task.steps].reverse()) {
      if (blocks.length >= 6) break;
      if (step.kind !== "tool" || step.toolId !== "shell.exec") continue;
      const args = step.toolArgs;
      const command =
        typeof args === "object" && args !== null
          ? ((args as Record<string, unknown>).command as string | undefined) ?? ""
          : "";
      blocks.push({
        command,
        stdout: truncate(stepResultText(step, "stdout")),
        stderr: truncate(stepResultText(step, "stderr")),
      });
    }
  }
  return blocks;
}

function BrowserPane({ conversationId }: Props) {
  const sessions = useStore((s) => s.browserSessions);
  const selectedSessionId = useStore((s) => s.selectedBrowserSessionId);
  const screenshot = useStore((s) => s.browserScreenshot);
  const screenshotPolling = useStore((s) => s.screenshotPolling);
  const tasks = useStore((s) => s.tasks);
  const active = useStore((s) => s.activityTab === "browser");
  const refreshBrowserSessions = useStore((s) => s.refreshBrowserSessions);
  const refreshScreenshot = useStore((s) => s.refreshScreenshot);
  const selectBrowserSession = useStore((s) => s.selectBrowserSession);
  const toggleScreenshotPolling = useStore((s) => s.toggleScreenshotPolling);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    refreshBrowserSessions()
      .then(() => {
        if (!cancelled) setOffline(false);
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshBrowserSessions]);

  const refreshAll = async () => {
    setError(null);
    try {
      await refreshBrowserSessions();
      setOffline(false);
    } catch {
      setOffline(true);
      return;
    }
    const state = useStore.getState();
    const sessionId =
      state.selectedBrowserSessionId ?? state.browserSessions[0]?.id;
    if (sessionId) {
      try {
        await refreshScreenshot(sessionId);
      } catch (err) {
        setError(messageOf(err));
      }
    }
  };

  const liveShot =
    screenshotPolling && screenshot !== null ? screenshot : null;
  const stepShot = lastBrowserShot(newestTask(tasks, conversationId));
  const shown = liveShot?.imageBase64 ?? stepShot;

  return (
    <div className={`activity-pane ${active ? "active" : ""}`}>
      {sessions.length > 0 && (
        <div className="session-chips">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={`session-chip ${
                session.id === selectedSessionId ? "active" : ""
              }`}
              onClick={() => selectBrowserSession(session.id)}
            >
              <span className="session-chip-title">
                {session.title || "Browser"}
              </span>
              <span className="session-chip-url">{session.url}</span>
            </button>
          ))}
        </div>
      )}
      <div className="browser-actions">
        <button
          className="btn btn-sm"
          onClick={() => void refreshAll()}
          disabled={sessions.length === 0}
        >
          <IconRefresh size={12} /> Refresh
        </button>
        <button
          className={`btn btn-sm ${screenshotPolling ? "btn-accent" : ""}`}
          onClick={() => toggleScreenshotPolling()}
          disabled={sessions.length === 0}
        >
          <IconCamera size={12} /> Live
        </button>
      </div>
      {error && <p className="files-error">{error}</p>}
      {shown ? (
        <div className="screenshot-wrap">
          {liveShot !== null && <span className="live-badge">LIVE</span>}
          <img
            className="screenshot-img"
            src={toDataUri(shown)}
            alt="Browser screenshot"
          />
        </div>
      ) : offline ? (
        <p className="browser-offline">No browser-capable Runner is online.</p>
      ) : (
        <div className="empty compact">No screenshot yet.</div>
      )}
    </div>
  );
}

function TerminalPane({
  tasks,
  conversationId,
}: {
  tasks: Task[];
  conversationId: string;
}) {
  const active = useStore((s) => s.activityTab === "terminal");
  const blocks = shellBlocks(tasks, conversationId);
  return (
    <div className={`activity-pane ${active ? "active" : ""}`}>
      {blocks.length === 0 ? (
        <div className="empty compact">
          No shell commands have run in this conversation yet.
        </div>
      ) : (
        <div className="terminal-blocks">
          {blocks.map((block, index) => (
            <div key={index} className="terminal-block">
              <div className="terminal-cmd">$ {block.command || "(no command)"}</div>
              {block.stdout && <div className="terminal-out">{block.stdout}</div>}
              {block.stderr && <div className="terminal-err">{block.stderr}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilesPane() {
  const active = useStore((s) => s.activityTab === "files");
  const filesPath = useStore((s) => s.filesPath);
  const filesEntries = useStore((s) => s.filesEntries);
  const filesContent = useStore((s) => s.filesContent);
  const listFiles = useStore((s) => s.listFiles);
  const readFile = useStore((s) => s.readFile);
  const navigateActivity = useStore((s) => s.navigateActivity);
  const [pathInput, setPathInput] = useState(filesPath);
  const [error, setError] = useState<string | null>(null);

  const runList = async (path: string) => {
    setError(null);
    try {
      await listFiles(path);
      setPathInput(path);
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const openEntry = async (entry: FilesEntry) => {
    setError(null);
    const target = joinPath(filesPath, entry.name);
    if (entry.type === "directory") {
      await runList(target);
      return;
    }
    try {
      await readFile(target);
    } catch (err) {
      setError(messageOf(err));
    }
  };

  return (
    <div className={`activity-pane ${active ? "active" : ""}`}>
      <div className="files-nav">
        <button
          className="icon-btn files-back"
          aria-label="Parent directory"
          onClick={() => void runList(parentPath(filesPath))}
        >
          <IconBack size={16} />
        </button>
        <input
          className="files-path"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runList(pathInput);
          }}
          placeholder="path (default .)"
          aria-label="Files path"
        />
        <button className="btn btn-sm" onClick={() => void runList(pathInput)}>
          List
        </button>
      </div>
      {error && <p className="files-error">{error}</p>}
      {filesContent ? (
        <>
          {filesContent.encoding &&
            filesContent.encoding !== "utf-8" &&
            filesContent.encoding !== "utf8" && (
              <p className="file-encoding">
                encoding: {filesContent.encoding}
              </p>
            )}
          <div className="file-content">
            <pre>{truncate(filesContent.content, 20000)}</pre>
          </div>
        </>
      ) : (
        <div className="files-entries">
          {filesEntries.length === 0 ? (
            <div className="empty compact">No entries.</div>
          ) : (
            filesEntries.map((entry) => (
              <button
                key={entry.name}
                className={`file-row ${entry.type}`}
                onClick={() => void openEntry(entry)}
              >
                {entry.type === "directory" ? (
                  <IconFolder size={16} className="file-icon" />
                ) : (
                  <IconFile size={16} className="file-icon" />
                )}
                <span className="file-row-name">{entry.name}</span>
                {entry.type === "file" && (
                  <span className="file-row-size">{formatBytes(entry.size)}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function ActivityPanel({ conversationId }: Props) {
  const activityTab = useStore((s) => s.activityTab);
  const tasks = useStore((s) => s.tasks);
  const lang = useStore((s) => s.lang);
  const screenshotPolling = useStore((s) => s.screenshotPolling);
  const setActivityTab = useStore((s) => s.setActivityTab);
  const toggleScreenshotPolling = useStore((s) => s.toggleScreenshotPolling);
  const refreshBrowserSessions = useStore((s) => s.refreshBrowserSessions);
  const cancelTask = useStore((s) => s.cancelTask);
  const pauseTask = useStore((s) => s.pauseTask);
  const resumeTask = useStore((s) => s.resumeTask);
  const [mobileOpen, setMobileOpen] = useState(false);

  const task = newestTask(tasks, conversationId);
  const live = task !== null && LIVE_TASK_STATUSES.includes(task.status);
  const thumb = lastBrowserShot(task);

  useEffect(() => {
    if (
      screenshotPolling &&
      task !== null &&
      !LIVE_TASK_STATUSES.includes(task.status)
    ) {
      toggleScreenshotPolling();
    }
  }, [task, screenshotPolling, toggleScreenshotPolling]);

  useEffect(() => {
    return () => {
      if (useStore.getState().screenshotPolling) {
        useStore.getState().toggleScreenshotPolling();
      }
    };
  }, []);

  const takeControl = async () => {
    await refreshBrowserSessions().catch(() => {});
    setActivityTab("browser");
    if (!useStore.getState().screenshotPolling) toggleScreenshotPolling();
  };

  const stopTask = () => {
    if (!task) return;
    if (window.confirm("Stop this task?")) void cancelTask(task.id).catch(() => {});
  };

  return (
    <section
      className={`activity-panel glass ${mobileOpen ? "" : "mobile-collapsed"}`}
      aria-label="Activity"
    >
      <button
        className="activity-summary"
        onClick={() => setMobileOpen((o) => !o)}
        aria-expanded={mobileOpen}
      >
        <span className="activity-summary-status">
          {task ? (
            <span className={`badge badge-${task.status}`}>
              {statusLabel(lang, task.status)}
            </span>
          ) : (
            <span className="activity-summary-idle">no active task</span>
          )}
        </span>
        {thumb && (
          <span className="activity-summary-thumb">
            <img src={toDataUri(thumb)} alt="Task screenshot" />
          </span>
        )}
        <IconChevron size={14} className={mobileOpen ? "open" : ""} />
      </button>
      <div className="activity-body">
        <div className="activity-head">
          <span className="activity-head-title">Activity</span>
          <div className="activity-tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activityTab === tab.id}
                className={`activity-tab ${activityTab === tab.id ? "active" : ""}`}
                onClick={() => setActivityTab(tab.id)}
              >
                {tab.id === "live" && <IconDot size={10} />}
                {tab.id === "browser" && <IconComputer size={13} />}
                {tab.id === "terminal" && <IconTerminal size={13} />}
                {tab.id === "files" && <IconFolder size={13} />}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className={`activity-pane ${activityTab === "live" ? "active" : ""}`}>
          {task ? (
            <>
              <TaskCard task={task} onCancel={stopTask} />
              {thumb && live && (
                <button
                  className="live-thumb"
                  onClick={() => setActivityTab("browser")}
                >
                  <img src={toDataUri(thumb)} alt="Latest browser screenshot" />
                </button>
              )}
              {live && (
                <div className="activity-controls">
                  {task.paused ? (
                    <button
                      className="btn btn-sm"
                      onClick={() => void resumeTask(task.id).catch(() => {})}
                    >
                      <IconPlay size={12} /> Resume
                    </button>
                  ) : (
                    <button
                      className="btn btn-sm"
                      onClick={() => void pauseTask(task.id).catch(() => {})}
                    >
                      <IconPause size={12} /> Pause
                    </button>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={stopTask}>
                    Stop
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => void takeControl()}
                  >
                    Take Control
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty compact">
              No task yet in this conversation.
            </div>
          )}
        </div>
        <BrowserPane conversationId={conversationId} />
        <TerminalPane tasks={tasks} conversationId={conversationId} />
        <FilesPane />
      </div>
    </section>
  );
}
