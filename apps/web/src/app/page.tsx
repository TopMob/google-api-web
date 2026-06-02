"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import PlaygroundTab from "../components/PlaygroundTab";
import KeysTab from "../components/KeysTab";
import LogsTab from "../components/LogsTab";
import FaqTab from "../components/FaqTab";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Project {
  id: string;
  name: string;
  created_at: string;
}

interface ApiKey {
  id: string;
  key: string;
  project_id: string;
  name: string;
  active: boolean;
  projects?: { name: string };
  allowed_models?: string[];
  daily_requests_limit?: number;
  daily_tokens_limit?: number;
  rate_limit_rpm?: number;
  expires_at?: string;
  created_at: string;
}

interface UsageLog {
  id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  duration_ms: number;
  status_code: number;
  created_at: string;
  projects?: { name: string };
  api_keys?: { name: string };
}

export default function Home() {
  // Tabs & General Navigation state
  const [activeTab, setActiveTab] = useState<"playground" | "keys" | "logs" | "faq">("playground");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  // Upstream Connection state
  const [gatewayStatus, setGatewayStatus] = useState<"online" | "offline" | "checking">("checking");
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:8081");
  const [models, setModels] = useState<string[]>([
    "gemini-3.5-flash",
    "gemini-3.5-flash-thinking",
    "gemini-3.1-pro",
    "gemini-auto",
    "gemini-3.5-flash-thinking-lite",
    "gemini-flash-lite"
  ]);
  const [selectedModel, setSelectedModel] = useState("gemini-3.5-flash");

  // Dashboard Stats state
  const [stats, setStats] = useState({
    requests: 0,
    estimatedTokens: 0,
    successRate: 100,
    activeTime: "0m"
  });

  // Projects & API Keys state
  const [projects, setProjects] = useState<Project[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [recentLogs, setRecentLogs] = useState<UsageLog[]>([]);
  
  const [newProjectName, setNewProjectName] = useState("");
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyProjectId, setNewKeyProjectId] = useState("00000000-0000-0000-0000-000000000000");
  const [dailyRequestsLimit, setDailyRequestsLimit] = useState("");
  const [dailyTokensLimit, setDailyTokensLimit] = useState("");
  const [rateLimitRpm, setRateLimitRpm] = useState("");
  const [newKeyExpiration, setNewKeyExpiration] = useState("never");
  const [playgroundKey, setPlaygroundKey] = useState("sk-personal-gw");

  // Playground Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Faq Tab / Cookie testing state
  const [cookieTestInput, setCookieTestInput] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTestingCookie, setIsTestingCookie] = useState(false);
  const [activeProvider, setActiveProvider] = useState<"opencode" | "vscode" | "codex" | "codex_cli" | "openclaw" | "cursor" | "jetbrains" | "zed">("opencode");
  const [activePlatform, setActivePlatform] = useState<"windows" | "macos" | "linux">("windows");

  // Timer Ref
  const startTimeRef = useRef<number>(Date.now());

  // API Call: Fetch status of Fastify Gateway health
  const checkHealth = async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.status === "online") {
        setGatewayStatus("online");
        setGatewayUrl(data.gatewayUrl);
      } else {
        setGatewayStatus("offline");
      }
    } catch {
      setGatewayStatus("offline");
    }
  };

  // API Call: Fetch list of supported models from gateway
  const fetchModels = async () => {
    try {
      const res = await fetch("/api/v1/models");
      if (res.ok) {
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) {
          setModels(data.data.map((m: any) => m.id));
        }
      }
    } catch {}
  };

  // API Call: Retrieve Projects, Keys, Stats, and Logs
  const fetchDbData = async () => {
    try {
      const projRes = await fetch("/api/projects");
      if (projRes.ok) {
        const projData = await projRes.json();
        setProjects(projData);
        if (projData.length > 0 && !newKeyProjectId) {
          setNewKeyProjectId(projData[0].id);
        }
      }

      const keysRes = await fetch("/api/keys");
      if (keysRes.ok) {
        setApiKeys(await keysRes.json());
      }

      const statsRes = await fetch("/api/stats");
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(prev => ({
          ...prev,
          requests: statsData.totalRequests,
          estimatedTokens: statsData.totalTokens,
          successRate: statsData.successRate
        }));
        setRecentLogs(statsData.recentLogs);
      }
    } catch {}
  };

  // Lifecycle hook for initial load and polling intervals
  useEffect(() => {
    checkHealth();
    fetchModels();
    fetchDbData();

    const interval = setInterval(() => {
      checkHealth();
      fetchDbData();
      
      const diffMins = Math.floor((Date.now() - startTimeRef.current) / 60000);
      setStats(prev => ({
        ...prev,
        activeTime: `${diffMins}m`
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Action: Copy active API key string
  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Action: Copy documentation configuration templates
  const copyGuideText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Action: Validate cookie credentials against gateway endpoints
  const handleTestCookie = async () => {
    if (!cookieTestInput.trim()) return;
    setIsTestingCookie(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cookieTestInput}`
        },
        body: JSON.stringify({
          model: selectedModel || "gemini-3.5-flash",
          messages: [{ role: "user", content: "Привет. Ответь ровно одним словом 'OK'" }],
          max_tokens: 5
        })
      });

      const data = await res.json();

      if (res.ok) {
        setTestResult({
          success: true,
          message: "Cookie string validated! Gateway connection with Google Gemini confirmed."
        });
      } else {
        let errMsg = "Validation failed. Inspect the copied cookie credentials.";
        if (data.error) {
          try {
            const parsedError = JSON.parse(data.error);
            if (parsedError.error?.message) {
              errMsg = parsedError.error.message;
            } else if (parsedError.message) {
              errMsg = parsedError.message;
            } else {
              errMsg = data.error;
            }
          } catch {
            errMsg = data.error.message || data.error;
          }
        }
        setTestResult({
          success: false,
          message: errMsg
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Failed to contact gateway server: ${err.message}`
      });
    } finally {
      setIsTestingCookie(false);
    }
  };

  // Action: Register a new developer project
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName })
      });
      if (res.ok) {
        setNewProjectName("");
        fetchDbData();
      }
    } catch {}
  };

  // Action: Generate a new client API Key
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || !newKeyProjectId) return;
    try {
      let expiresAt: string | null = null;
      if (newKeyExpiration !== "never") {
        const now = new Date();
        if (newKeyExpiration === "1h") {
          now.setHours(now.getHours() + 1);
        } else if (newKeyExpiration === "24h") {
          now.setHours(now.getHours() + 24);
        } else if (newKeyExpiration === "7d") {
          now.setDate(now.getDate() + 7);
        } else if (newKeyExpiration === "30d") {
          now.setDate(now.getDate() + 30);
        } else if (newKeyExpiration === "90d") {
          now.setDate(now.getDate() + 90);
        }
        expiresAt = now.toISOString();
      }

      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: newKeyName, 
          project_id: newKeyProjectId,
          expires_at: expiresAt
        })
      });
      if (res.ok) {
        setNewKeyName("");
        setNewKeyExpiration("never");
        fetchDbData();
      }
    } catch {}
  };

  // Action: Toggle client API Key activation state
  const handleToggleKey = async (id: string, currentStatus: boolean) => {
    try {
      const res = await fetch("/api/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !currentStatus })
      });
      if (res.ok) {
        fetchDbData();
      }
    } catch {}
  };

  // Action: Submit query to playground chat and handle text stream response
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    const assistantMsgIndex = newMessages.length;
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${playgroundKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: newMessages,
          stream: true,
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(dataStr);
              const content = parsed.choices?.[0]?.delta?.content || "";
              if (content) {
                accumulated += content;
                setMessages(prev => {
                  const next = [...prev];
                  if (next[assistantMsgIndex]) {
                    next[assistantMsgIndex] = {
                      role: "assistant",
                      content: accumulated
                    };
                  }
                  return next;
                });
              }
            } catch {}
          }
        }
      }

      fetchDbData();

    } catch {
      setMessages(prev => {
        const next = [...prev];
        if (next[assistantMsgIndex]) {
          next[assistantMsgIndex] = {
            role: "assistant",
            content: "Error: Failed to stream execution response from local gateway."
          };
        }
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#07080a] overflow-hidden text-zinc-300 font-sans">
      {/* Sidebar navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        gatewayUrl={gatewayUrl}
        gatewayStatus={gatewayStatus}
        playgroundKey={playgroundKey}
        setPlaygroundKey={setPlaygroundKey}
        apiKeys={apiKeys}
      />

      {/* Main console content panel */}
      <main className="flex-1 flex flex-col justify-between bg-[#07080a] overflow-hidden">
        <Header
          activeTab={activeTab}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          models={models}
          fetchModels={fetchModels}
          stats={stats}
        />

        {/* Tab viewports */}
        {activeTab === "playground" && (
          <PlaygroundTab
            messages={messages}
            input={input}
            setInput={setInput}
            isLoading={isLoading}
            handleSubmit={handleSubmit}
            gatewayStatus={gatewayStatus}
          />
        )}

        {activeTab === "keys" && (
          <KeysTab
            apiKeys={apiKeys}
            newKeyName={newKeyName}
            setNewKeyName={setNewKeyName}
            newKeyExpiration={newKeyExpiration}
            setNewKeyExpiration={setNewKeyExpiration}
            handleCreateKey={handleCreateKey}
            handleToggleKey={handleToggleKey}
            copiedKey={copiedKey}
            copyText={copyText}
          />
        )}

        {activeTab === "logs" && <LogsTab recentLogs={recentLogs} />}

        {activeTab === "faq" && (
          <FaqTab
            cookieTestInput={cookieTestInput}
            setCookieTestInput={setCookieTestInput}
            testResult={testResult}
            isTestingCookie={isTestingCookie}
            handleTestCookie={handleTestCookie}
            activeProvider={activeProvider}
            setActiveProvider={setActiveProvider}
            activePlatform={activePlatform}
            setActivePlatform={setActivePlatform}
            copiedId={copiedId}
            copyGuideText={copyGuideText}
            selectedModel={selectedModel}
            activeKey={playgroundKey}
            gatewayUrl={gatewayUrl}
            models={models}
          />
        )}
      </main>
    </div>
  );
}
