"use client";

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import Sidebar, { TabType } from "../components/Sidebar";
import Header from "../components/Header";
import ChatTab, { ChatMessage } from "../components/ChatTab";
import ConnectTab, { ApiKeyItem, CookieStatusData, ProjectItem, GoogleAccountItem } from "../components/ConnectTab";
import LogsTab, { StatsSummary, UsageLogItem } from "../components/LogsTab";
import { Language } from "../utils/i18n";

const LANG_STORAGE_KEY = "gemini_web2api_lang";
const CHAT_STORAGE_KEY = "gemini_web2api_chat_history";

function subscribeLang(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("gemini-lang-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("gemini-lang-change", callback);
  };
}

function getLangSnapshot(): Language {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {}
  return "ru";
}

function getLangServerSnapshot(): Language {
  return "ru";
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("chat");
  const lang = useSyncExternalStore(subscribeLang, getLangSnapshot, getLangServerSnapshot);

  // Gateway & model state
  const [gatewayStatus, setGatewayStatus] = useState<"online" | "warning" | "offline" | "checking">("checking");
  const [cookieValid, setCookieValid] = useState<boolean | null>(null);
  const [cookieHasFile, setCookieHasFile] = useState<boolean | null>(null);
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:8081");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [thinkDepth, setThinkDepth] = useState<"auto" | "0" | "4">("auto");

  // Projects, keys, cookies, logs
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [activeKey, setActiveKey] = useState<string>("sk-personal-gw");
  const [cookieStatus, setCookieStatus] = useState<CookieStatusData | null>(null);
  const [accounts, setAccounts] = useState<GoogleAccountItem[]>([]);
  const [activeAuthUser, setActiveAuthUser] = useState<string>("0");
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [recentLogs, setRecentLogs] = useState<UsageLogItem[]>([]);
  const [stats, setStats] = useState<StatsSummary>({
    totalRequests: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    avgDurationMs: 0,
    successRate: 100
  });

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatHydratedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setMessages(parsed);
          }
        }
      } catch {}
      chatHydratedRef.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!chatHydratedRef.current || isLoading) return;
    try {
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      try {
        const withoutImages = messages.map(({ role, content }) => ({ role, content }));
        sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(withoutImages));
      } catch {}
    }
  }, [messages, isLoading]);

  const handleSetLang = (newLang: Language) => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, newLang);
      window.dispatchEvent(new Event("gemini-lang-change"));
    } catch {}
  };

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.gatewayUrl) setGatewayUrl(data.gatewayUrl);
      if (data.status === "online" || data.status === "warning") {
        setGatewayStatus(data.status);
        if (typeof data.cookieValid === "boolean" || data.cookieValid === null) {
          setCookieValid(data.cookieValid);
        }
        if (typeof data.cookieHasFile === "boolean") {
          setCookieHasFile(data.cookieHasFile);
        }
      } else {
        setGatewayStatus("offline");
      }
    } catch {
      setGatewayStatus("offline");
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/models");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data)) {
          const list: string[] = data.data.map((m: { id: string }) => m.id);
          if (list.length > 0) {
            setModels(list);
            setSelectedModel((prev) => (prev && list.includes(prev) ? prev : list[0]));
          }
        }
      }
    } catch {}
  }, []);

  const fetchCookieStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cookies/status");
      if (res.ok) {
        const data: CookieStatusData = await res.json();
        setCookieStatus(data);
        setCookieHasFile(data.hasFile);
        if (typeof data.isValid === "boolean" || data.isValid === null) {
          setCookieValid(data.isValid);
        }
      }
    } catch {}
  }, []);

  const fetchAccounts = useCallback(async (forceRefresh = false) => {
    setIsLoadingAccounts(true);
    try {
      const url = forceRefresh ? "/api/accounts?refresh=true" : "/api/accounts";
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as {
          activeAuthUser?: string;
          accounts?: GoogleAccountItem[];
        };
        if (typeof data.activeAuthUser === "string") {
          setActiveAuthUser(data.activeAuthUser);
        }
        if (Array.isArray(data.accounts)) {
          setAccounts(data.accounts);
        }
      }
    } catch {
      // ignore transient network errors
    } finally {
      setIsLoadingAccounts(false);
    }
  }, []);

  const handleSelectAccount = useCallback(
    async (authUser: string) => {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authUser })
      });
      if (res.ok) {
        setActiveAuthUser(authUser);
        await Promise.all([checkHealth(), fetchModels(), fetchCookieStatus()]);
      }
    },
    [checkHealth, fetchModels, fetchCookieStatus]
  );

  const fetchDbData = useCallback(async () => {
    try {
      const [projRes, keysRes, statsRes] = await Promise.all([
        fetch("/api/projects"),
        fetch("/api/keys"),
        fetch("/api/stats?limit=100")
      ]);

      if (projRes.ok) {
        setProjects(await projRes.json());
      }
      if (keysRes.ok) {
        const keysData: ApiKeyItem[] = await keysRes.json();
        setApiKeys(keysData);
        setActiveKey((prev) => {
          const activeList = keysData.filter((k) => k.active);
          if (activeList.some((k) => k.key === prev)) return prev;
          return activeList[0]?.key || prev;
        });
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats({
          totalRequests: statsData.totalRequests ?? 0,
          totalTokens: statsData.totalTokens ?? 0,
          totalPromptTokens: statsData.totalPromptTokens ?? 0,
          totalCompletionTokens: statsData.totalCompletionTokens ?? 0,
          avgDurationMs: statsData.avgDurationMs ?? 0,
          successRate: statsData.successRate ?? 100
        });
        setRecentLogs(Array.isArray(statsData.recentLogs) ? statsData.recentLogs : []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      void Promise.all([checkHealth(), fetchModels(), fetchDbData(), fetchCookieStatus(), fetchAccounts()]);
    }, 0);

    const interval = setInterval(() => {
      void checkHealth();
      void fetchDbData();
    }, 30000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [checkHealth, fetchModels, fetchDbData, fetchCookieStatus, fetchAccounts]);

  const handleCreateProject = async (name: string) => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      await fetchDbData();
    }
  };

  const handleCreateKey = async (payload: {
    name: string;
    project_id: string;
    expires_at: string | null;
    rate_limit_rpm: number | null;
    daily_requests_limit: number | null;
    daily_tokens_limit: number | null;
    temporary_chats: boolean;
  }) => {
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      await fetchDbData();
    }
  };

  const handleToggleKey = async (id: string, currentStatus: boolean) => {
    const res = await fetch("/api/keys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: !currentStatus })
    });
    if (res.ok) {
      await fetchDbData();
    }
  };

  const handleToggleTemporaryChats = async (id: string, current: boolean) => {
    const res = await fetch("/api/keys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, temporary_chats: !current })
    });
    if (res.ok) {
      await fetchDbData();
    }
  };

  const handleDeleteKey = async (id: string) => {
    const res = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    if (res.ok) {
      await fetchDbData();
    }
  };

  const handleClearLogs = async () => {
    const res = await fetch("/api/stats", { method: "DELETE" });
    if (res.ok) {
      await fetchDbData();
    }
  };

  const handleSaveCookie = async (cookieStr: string): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch("/api/cookies/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookieStr })
      });
      const data = await res.json();
      await Promise.all([fetchCookieStatus(), checkHealth(), fetchModels(), fetchAccounts(true)]);
      return {
        success: Boolean(res.ok && data.success),
        message: data.message || (res.ok ? "Saved" : "Validation failed")
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Failed to reach gateway"
      };
    }
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
  };

  const handleClear = () => {
    handleStop();
    setMessages([]);
    try {
      sessionStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {}
  };

  const handleSubmit = async (textOverride?: string, image?: string) => {
    const promptText = textOverride !== undefined ? textOverride : input;
    if ((!promptText.trim() && !image) || isLoading) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: promptText,
      image
    };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    if (textOverride === undefined) {
      setInput("");
    }
    setIsLoading(true);

    const assistantIndex = nextMessages.length;
    const controller = new AbortController();
    abortRef.current = controller;

    const modelToUse =
      thinkDepth !== "auto" && selectedModel && !selectedModel.includes("@think=")
        ? `${selectedModel}@think=${thinkDepth}`
        : selectedModel || "gemini-4-hydrogen";

    const apiMessages = nextMessages.map((m) => {
      if (m.image) {
        const parts: Array<Record<string, unknown>> = [];
        if (m.content.trim()) {
          parts.push({ type: "text", text: m.content });
        }
        parts.push({ type: "image_url", image_url: { url: m.image } });
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: m.content };
    });

    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeKey}`
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: apiMessages,
          stream: true
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";
      let streamEnded = false;

      while (!streamEnded) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === "[DONE]") {
            streamEnded = true;
            break;
          }
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) {
              accumulated += delta;
              setMessages((prev) => {
                const updated = [...prev];
                if (updated[assistantIndex]) {
                  updated[assistantIndex] = { role: "assistant", content: accumulated };
                }
                return updated;
              });
            }
          } catch {}
        }
      }

      fetchDbData();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      let errMsg = "Failed to receive response from gateway.";
      if (err instanceof Error && err.message) {
        try {
          const parsed = JSON.parse(err.message);
          errMsg = parsed?.error?.message || (typeof parsed?.error === "string" ? parsed.error : err.message);
        } catch {
          errMsg = err.message;
        }
      }

      setMessages((prev) => {
        const updated = [...prev];
        if (updated[assistantIndex]) {
          updated[assistantIndex] = { role: "assistant", content: `Error: ${errMsg}` };
        }
        return updated;
      });
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  const activeKeyObj = apiKeys.find((k) => k.key === activeKey);
  const activeTemporaryChats = activeKeyObj?.temporary_chats ?? true;

  const handleToggleActiveTemporaryChats = () => {
    if (!activeKeyObj) return;
    void handleToggleTemporaryChats(activeKeyObj.id, activeKeyObj.temporary_chats ?? true);
  };

  return (
    <div className="flex h-screen bg-[#0a0b0e] overflow-hidden text-[#eceef4]">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        gatewayStatus={gatewayStatus}
        cookieValid={cookieValid}
        cookieHasFile={cookieHasFile}
        lang={lang}
        setLang={handleSetLang}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#0a0b0e] overflow-hidden">
        <Header
          activeTab={activeTab}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          models={models}
          fetchModels={fetchModels}
          thinkDepth={thinkDepth}
          setThinkDepth={setThinkDepth}
          temporaryChats={activeTemporaryChats}
          canToggleTemporaryChats={Boolean(activeKeyObj)}
          onToggleTemporaryChats={handleToggleActiveTemporaryChats}
          hasMessages={messages.length > 0}
          isLoading={isLoading}
          onClearChat={handleClear}
          lang={lang}
        />

        {activeTab === "chat" ? (
          <ChatTab
            messages={messages}
            input={input}
            setInput={setInput}
            isLoading={isLoading}
            cookieValid={cookieValid}
            onGoToConnect={() => setActiveTab("connect")}
            handleSubmit={handleSubmit}
            handleStop={handleStop}
            lang={lang}
          />
        ) : null}

        {activeTab === "connect" ? (
          <ConnectTab
            gatewayUrl={gatewayUrl}
            models={models}
            selectedModel={selectedModel}
            projects={projects}
            apiKeys={apiKeys}
            activeKey={activeKey}
            setActiveKey={setActiveKey}
            onCreateProject={handleCreateProject}
            onCreateKey={handleCreateKey}
            onToggleKey={handleToggleKey}
            onToggleTemporaryChats={handleToggleTemporaryChats}
            onDeleteKey={handleDeleteKey}
            cookieStatus={cookieStatus}
            onSaveCookie={handleSaveCookie}
            accounts={accounts}
            activeAuthUser={activeAuthUser}
            isLoadingAccounts={isLoadingAccounts}
            onRefreshAccounts={() => fetchAccounts(true)}
            onSelectAccount={handleSelectAccount}
            lang={lang}
          />
        ) : null}

        {activeTab === "logs" ? (
          <LogsTab
            stats={stats}
            recentLogs={recentLogs}
            onRefresh={fetchDbData}
            onClear={handleClearLogs}
            lang={lang}
          />
        ) : null}
      </main>
    </div>
  );
}
