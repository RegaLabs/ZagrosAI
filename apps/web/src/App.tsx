import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AgentsView } from "./components/AgentsView.js";
import { CapabilityManager } from "./components/CapabilityManager.js";
import { ChatList } from "./components/ChatList.js";
import { ConversationView } from "./components/ConversationView.js";
import { DelegationExplorer } from "./components/DelegationExplorer.js";
import {
  IconBot,
  IconChat,
  IconClock,
  IconCpu,
  IconDot,
  IconGear,
  IconList,
  IconMemory,
  IconNetwork,
  IconSkills,
  IconZagrosLogo,
} from "./components/Icons.js";
import { MemoryView } from "./components/MemoryView.js";
import { OnboardingModal } from "./components/OnboardingModal.js";
import { RoutinesView } from "./components/RoutinesView.js";
import { SettingsView } from "./components/SettingsView.js";
import { SkillsView } from "./components/SkillsView.js";
import { TasksView } from "./components/TasksView.js";
import { t } from "./i18n.js";
import type { Lang } from "./i18n.js";
import { useStore, type Tab } from "./store.js";

function NavItems({
  tab,
  onSelect,
  mobile,
  lang,
}: {
  tab: Tab;
  onSelect: (tab: Tab) => void;
  mobile: boolean;
  lang: Lang;
}) {
  const items: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "chats", label: t(lang, "nav.chats"), icon: <IconChat size={20} /> },
    { id: "agents", label: t(lang, "nav.agents"), icon: <IconBot size={20} /> },
    { id: "tasks", label: t(lang, "nav.tasks"), icon: <IconList size={20} /> },
  ];
  if (!mobile) {
    items.push({ id: "capabilities", label: "Capabilities", icon: <IconCpu size={20} /> });
    items.push({ id: "routines", label: t(lang, "nav.routines"), icon: <IconClock size={20} /> });
    items.push({ id: "delegation", label: "Delegation & A2A", icon: <IconNetwork size={20} /> });
    items.push({ id: "memory", label: t(lang, "nav.memory"), icon: <IconMemory size={20} /> });
    items.push({ id: "skills", label: t(lang, "nav.skills"), icon: <IconSkills size={20} /> });
  } else {
    items.push({ id: "capabilities", label: "Models", icon: <IconCpu size={20} /> });
  }
  items.push({
    id: "settings",
    label: mobile ? t(lang, "nav.more") : t(lang, "nav.settings"),
    icon: <IconGear size={20} />,
  });
  return (
    <>
      {items.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${tab === item.id ? "active" : ""}`}
          onClick={() => onSelect(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </>
  );
}

function MoreMenu({ onSelect }: { onSelect: (tab: Tab) => void }) {
  const items: { id: Tab; label: string; desc: string; icon: ReactNode }[] = [
    {
      id: "capabilities",
      label: "Capability Manager",
      desc: "Models, capabilities, harness logins, fallbacks",
      icon: <IconCpu size={20} />,
    },
    {
      id: "routines",
      label: "Routines Dashboard",
      desc: "Scheduled tasks, webhook triggers, execution logs",
      icon: <IconClock size={20} />,
    },
    {
      id: "delegation",
      label: "Delegation & A2A Explorer",
      desc: "Subtask tree, A2A agent cards, shared artifacts",
      icon: <IconNetwork size={20} />,
    },
    {
      id: "settings",
      label: "Settings",
      desc: "MCP servers, notifications, connections",
      icon: <IconGear size={20} />,
    },
    {
      id: "memory",
      label: "Memory",
      desc: "Episodic, semantic and procedural memories",
      icon: <IconMemory size={20} />,
    },
    {
      id: "skills",
      label: "Skills",
      desc: "Install, view and test skills",
      icon: <IconSkills size={20} />,
    },
  ];
  return (
    <div className="view">
      <header className="view-header">
        <h2 className="view-title">More Features</h2>
      </header>
      <ul className="more-list">
        {items.map((item) => (
          <li key={item.id}>
            <button className="more-item glass" onClick={() => onSelect(item.id)}>
              {item.icon}
              <div className="more-item-text">
                <span className="more-item-label">{item.label}</span>
                <span className="more-item-desc">{item.desc}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const connectWs = useStore((s) => s.connectWs);
  const loadAll = useStore((s) => s.loadAll);
  const connected = useStore((s) => s.connected);
  const workers = useStore((s) => s.workers);
  const lang = useStore((s) => s.lang);
  const loadConversation = useStore((s) => s.loadConversation);
  const tab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const conversationId = useStore((s) => s.activeConversationId);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem("zagros_onboarded") !== "true";
  });

  useEffect(() => {
    connectWs();
    void loadAll().catch(() => {});
  }, [connectWs, loadAll]);

  const selectTab = (next: Tab, mobile: boolean) => {
    setActiveTab(next);
    setMobileMenu(mobile && next === "settings");
  };

  const openConversation = (id: string | null) => {
    setActiveConversation(id);
    if (id) {
      setActiveTab("chats");
      setMobileMenu(false);
      void loadConversation(id).catch(() => {});
    }
  };

  const onlineCount = workers.filter((w) => w.online).length;

  let main: ReactNode;
  if (tab === "agents") {
    main = <AgentsView />;
  } else if (tab === "tasks") {
    main = <TasksView />;
  } else if (tab === "capabilities") {
    main = <CapabilityManager />;
  } else if (tab === "routines") {
    main = <RoutinesView />;
  } else if (tab === "delegation") {
    main = <DelegationExplorer />;
  } else if (tab === "memory") {
    main = <MemoryView />;
  } else if (tab === "skills") {
    main = <SkillsView />;
  } else if (tab === "settings") {
    main = mobileMenu ? (
      <MoreMenu
        onSelect={(next) => {
          setActiveTab(next);
          setMobileMenu(false);
        }}
      />
    ) : (
      <SettingsView />
    );
  } else if (conversationId) {
    main = (
      <div className="chat-split">
        <div className="convo-pane">
          <ChatList selectedId={conversationId} onSelect={openConversation} />
        </div>
        <ConversationView
          key={conversationId}
          conversationId={conversationId}
          onBack={() => setActiveConversation(null)}
        />
      </div>
    );
  } else {
    main = <ChatList selectedId={null} onSelect={openConversation} />;
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rail glass">
        <div className="logo">
          <div className="logo-badge-icon">
            <img src="/Zagros.png" alt="Zagros Logo" className="logo-img" />
          </div>
          <div className="logo-titles">
            <span className="logo-text">{t(lang, "appName")}</span>
            <span className="logo-subtext">Enterprise Agent OS</span>
          </div>
        </div>
        <nav className="rail-nav" aria-label="Primary">
          <NavItems
            tab={tab}
            onSelect={(next) => selectTab(next, false)}
            mobile={false}
            lang={lang}
          />
        </nav>
        <div className="rail-workers">
          <span className="rail-status">
            <IconDot size={8} className={connected ? "dot-online" : "dot-offline"} />
            {connected ? "connected" : "connecting…"}
          </span>
          <span className="rail-worker-count">
            {onlineCount}/{workers.length} workers online
          </span>
        </div>
      </aside>
      <main id="main" className="content">
        {main}
      </main>
      <nav className="mobile-nav glass" aria-label="Primary">
        <NavItems
          tab={tab}
          onSelect={(next) => selectTab(next, true)}
          mobile
          lang={lang}
        />
      </nav>
      <OnboardingModal
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
      />
    </div>
  );
}
