import { useState } from "react";
import { useStore } from "../store.js";
import { timeAgo } from "../format.js";
import type { TaskStatus } from "../types.js";
import { IconChevron, IconList } from "./Icons.js";
import { TaskCard } from "./TaskCard.js";

function taskLabel(status: TaskStatus): string {
  if (status === "waiting_for_approval") return "awaiting approval";
  return status.replace(/_/g, " ");
}

export function TasksView() {
  const tasks = useStore((s) => s.tasks);
  const cancelTask = useStore((s) => s.cancelTask);
  const pauseTask = useStore((s) => s.pauseTask);
  const resumeTask = useStore((s) => s.resumeTask);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const openConversation = (id: string) => {
    setActiveConversation(id);
    setActiveTab("chats");
  };

  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">Tasks</h2>
      </header>
      {sorted.length === 0 ? (
        <div className="empty">
          <IconList size={36} />
          <p>No tasks yet. Send a message to start a run.</p>
        </div>
      ) : (
        <ul className="task-list">
          {sorted.map((task) => {
            const expanded = expandedId === task.id;
            return (
              <li key={task.id} className="task-list-item glass">
                <button
                  className="task-list-toggle"
                  onClick={() => setExpandedId(expanded ? null : task.id)}
                  aria-expanded={expanded}
                >
                  <IconChevron size={14} className={expanded ? "open" : ""} />
                  <span className={`badge badge-${task.status}`}>
                    {taskLabel(task.status)}
                  </span>
                  <span className="task-list-title">Task {task.id.slice(-6)}</span>
                  <span className="task-list-time">{timeAgo(task.createdAt)}</span>
                </button>
                {expanded && (
                  <div className="task-list-detail">
                    {task.status === "waiting_for_approval" &&
                      task.conversationId && (
                        <div className="task-list-actions">
                          <button
                            className="btn btn-sm"
                            onClick={() => openConversation(task.conversationId)}
                          >
                            Open
                          </button>
                        </div>
                      )}
                    <TaskCard
                      task={task}
                      onCancel={() => void cancelTask(task.id).catch(() => {})}
                      onPause={() => void pauseTask(task.id).catch(() => {})}
                      onResume={() => void resumeTask(task.id).catch(() => {})}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
