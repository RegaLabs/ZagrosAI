import { useEffect, useRef } from "react";
import { newestLiveTask, useStore } from "../store.js";
import { ActivityPanel } from "./ActivityPanel.js";
import { ApprovalCard } from "./ApprovalCard.js";
import { Composer } from "./Composer.js";
import { IconBack, IconChat } from "./Icons.js";
import { MessageBubble } from "./MessageBubble.js";
import { TaskCard } from "./TaskCard.js";

interface Props {
  conversationId: string;
  onBack: () => void;
}

export function ConversationView({ conversationId, onBack }: Props) {
  const messages = useStore((s) => s.messagesByConversation[conversationId]);
  const streaming = useStore((s) => s.streamingByConversation[conversationId]);
  const conversations = useStore((s) => s.conversations);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const approvals = useStore((s) => s.approvals);
  const loadConversation = useStore((s) => s.loadConversation);
  const cancelTask = useStore((s) => s.cancelTask);
  const pauseTask = useStore((s) => s.pauseTask);
  const resumeTask = useStore((s) => s.resumeTask);
  const decideApproval = useStore((s) => s.decideApproval);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadConversation(conversationId).catch(() => {});
  }, [conversationId, loadConversation]);

  const summary = conversations.find((c) => c.id === conversationId);
  const agent = agents.find((a) => a.id === (summary?.agentId ?? ""));
  const agentName = summary?.agentName ?? agent?.name ?? "Assistant";
  const title = summary?.title ?? "Chat";
  const allMessages = messages ?? [];
  const liveTask = newestLiveTask(tasks, conversationId);
  const streamText = streaming && streaming.text.length > 0 ? streaming.text : null;
  const convoApprovals = approvals
    .filter((a) => a.conversationId === conversationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [allMessages.length, streamText, liveTask, convoApprovals.length]);

  return (
    <div className="chat-with-activity">
      <div className="chat-main">
        <header className="chat-header glass">
          <button
            className="icon-btn back-btn"
            aria-label="Back to chats"
            onClick={onBack}
          >
            <IconBack size={18} />
          </button>
          <div className="chat-header-text">
            <h2 className="chat-title">{title}</h2>
            <span className="chat-agent">{agentName}</span>
          </div>
        </header>
        <div className="messages" ref={scrollRef}>
          <div className="messages-inner">
            {allMessages.length === 0 && !streamText ? (
              <div className="empty">
                <IconChat size={36} />
                <p>No messages yet — say hello.</p>
              </div>
            ) : (
              <>
                {allMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {streamText && (
                  <div className="bubble-row assistant">
                    <div className="bubble assistant-bubble glass">
                      <p className="bubble-text">
                        {streamText}
                        <span className="stream-cursor">▍</span>
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {liveTask && (
          <div className="task-card-host">
            <TaskCard
              task={liveTask}
              onCancel={() => void cancelTask(liveTask.id).catch(() => {})}
              onPause={() => void pauseTask(liveTask.id).catch(() => {})}
              onResume={() => void resumeTask(liveTask.id).catch(() => {})}
            />
          </div>
        )}
        {convoApprovals.map((approval) => (
          <div className="task-card-host" key={approval.id}>
            <ApprovalCard
              approval={approval}
              onDecide={(decision) => decideApproval(approval.id, decision)}
            />
          </div>
        ))}
      </div>
      <ActivityPanel conversationId={conversationId} />
      <Composer conversationId={conversationId} busy={liveTask !== null} />
    </div>
  );
}
