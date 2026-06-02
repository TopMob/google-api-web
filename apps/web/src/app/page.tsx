"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Sparkles, 
  Send, 
  Layers, 
  Key, 
  Copy, 
  Check, 
  RefreshCw,
  Terminal,
  Cpu,
  Bot,
  User,
  Shield,
  PlusCircle,
  Activity,
  Clock,
  Settings,
  Plus,
  HelpCircle,
  ExternalLink,
  Info,
  Lock,
  FileText,
  BookOpen,
  Code
} from "lucide-react";


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
  const [activeTab, setActiveTab] = useState<"playground" | "keys" | "logs" | "faq">("playground");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cookieTestInput, setCookieTestInput] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTestingCookie, setIsTestingCookie] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<"online" | "offline" | "checking">("checking");
  const [activeProvider, setActiveProvider] = useState<"opencode" | "vscode" | "codex" | "codex_cli" | "openclaw" | "cursor" | "jetbrains" | "zed">("opencode");
  const [activePlatform, setActivePlatform] = useState<"windows" | "macos" | "linux">("windows");



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
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  const [stats, setStats] = useState({
    requests: 0,
    estimatedTokens: 0,
    successRate: 100,
    activeTime: "0m"
  });

  const [projects, setProjects] = useState<Project[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [recentLogs, setRecentLogs] = useState<UsageLog[]>([]);
  
  const [newProjectName, setNewProjectName] = useState("");
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyProjectId, setNewKeyProjectId] = useState("");
  const [dailyRequestsLimit, setDailyRequestsLimit] = useState("");
  const [dailyTokensLimit, setDailyTokensLimit] = useState("");
  const [rateLimitRpm, setRateLimitRpm] = useState("");
  const [playgroundKey, setPlaygroundKey] = useState("sk-personal-gw");
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const copyGuideText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

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
          message: "Куки успешно валидированы! Шлюз подтвердил соединение с Google Gemini."
        });
      } else {
        let errMsg = "Ошибка проверки. Проверьте правильность скопированных куки.";
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
        message: `Не удалось связаться со шлюзом: ${err.message}`
      });
    } finally {
      setIsTestingCookie(false);
    }
  };



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

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || !newKeyProjectId) return;
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: newKeyName, 
          project_id: newKeyProjectId,
          daily_requests_limit: dailyRequestsLimit || null,
          daily_tokens_limit: dailyTokensLimit || null,
          rate_limit_rpm: rateLimitRpm || null
        })
      });
      if (res.ok) {
        setNewKeyName("");
        setDailyRequestsLimit("");
        setDailyTokensLimit("");
        setRateLimitRpm("");
        fetchDbData();
      }
    } catch {}
  };

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
            content: "Error: Failed to fetch response from local gateway."
          };
        }
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#07080d] overflow-hidden text-slate-200">
      <aside className="w-80 border-r border-[#1a1d2e] bg-[#0c0e18] flex flex-col justify-between p-6">
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Gemini Web2API Logo" className="h-10 w-10 rounded-xl border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.25)] hover:scale-105 transition-all duration-300 object-cover" />
            <div>
              <h1 className="text-sm font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Gemini Web2API
              </h1>
              <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">
                OPENAI-COMPATIBLE
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <button
              onClick={() => setActiveTab("playground")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition ${
                activeTab === "playground" ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Bot size={16} />
              <span>Playground Chat</span>
            </button>
            <button
              onClick={() => setActiveTab("keys")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition ${
                activeTab === "keys" ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Key size={16} />
              <span>Projects & API Keys</span>
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition ${
                activeTab === "logs" ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Terminal size={16} />
              <span>Real-time Usage Logs</span>
            </button>
            <button
              onClick={() => setActiveTab("faq")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition ${
                activeTab === "faq" ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <HelpCircle size={16} />
              <span>FAQ / Cookie Guide</span>
            </button>
          </div>


          <div className="space-y-4">
            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2 block">
                UPSTREAM CONNECTION
              </label>
              <div className="flex items-center justify-between p-3.5 bg-[#121626] border border-[#1e233b] rounded-xl">
                <div className="space-y-1">
                  <div className="text-xs font-semibold">Fastify Node.js</div>
                  <div className="text-[10px] text-slate-400 font-mono">{gatewayUrl}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${
                    gatewayStatus === "online" 
                      ? "bg-emerald-500 pulse-glow-green" 
                      : gatewayStatus === "offline" 
                      ? "bg-rose-500 pulse-glow-red" 
                      : "bg-amber-500 animate-pulse"
                  }`} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {gatewayStatus}
                  </span>
                </div>
              </div>
            </div>



            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2 block">
                PLAYGROUND API KEY
              </label>
              <div className="relative">
                <Key size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={playgroundKey}
                  onChange={(e) => setPlaygroundKey(e.target.value)}
                  className="w-full bg-[#121626] border border-[#1e233b] hover:border-blue-500/50 rounded-xl pl-10 pr-4 py-3 text-xs font-semibold text-slate-200 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer appearance-none animate-none"
                >
                  <option value="sk-personal-gw" className="bg-[#0c0e18]">sk-personal-gw (Admin Bypass)</option>
                  {apiKeys.filter(k => k.active).map((k) => (
                    <option key={k.id} value={k.key} className="bg-[#0c0e18]">
                      {k.name} ({k.key.substring(0, 15)}...)
                    </option>
                  ))}
                </select>
              </div>
            </div>


          </div>
        </div>


      </aside>

      <main className="flex-1 flex flex-col justify-between bg-[#08090e]">
        <header className="h-16 border-b border-[#1a1d2e] bg-[#0c0e18]/80 backdrop-blur px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm font-bold flex items-center gap-2">
              {activeTab === "playground" && (
                <>
                  <Bot size={16} className="text-blue-400" />
                  <span>Gateway Playroom</span>
                </>
              )}
              {activeTab === "keys" && (
                <>
                  <Key size={16} className="text-blue-400" />
                  <span>Projects & API Keys</span>
                </>
              )}
              {activeTab === "logs" && (
                <>
                  <Terminal size={16} className="text-blue-400" />
                  <span>Real-time Usage Logs</span>
                </>
              )}
              {activeTab === "faq" && (
                <>
                  <HelpCircle size={16} className="text-blue-400" />
                  <span>FAQ & Cookie Instructions</span>
                </>
              )}
            </div>
            <span className="h-4 w-px bg-[#1a1d2e]" />
            <div className="text-xs text-slate-400 flex items-center gap-2">
              <Cpu size={14} className="text-blue-400" />
              <span className="font-semibold text-slate-300">Model:</span>
              <div className="relative flex items-center">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-[#121626] border border-[#1e233b] hover:border-blue-500/50 rounded-lg pl-3 pr-8 py-1.5 text-xs font-semibold text-slate-200 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer appearance-none font-mono"
                >
                  {models.map((m) => (
                    <option key={m} value={m} className="bg-[#0c0e18] font-mono">
                      {m}
                    </option>
                  ))}
                </select>
                <div className="absolute right-2 pointer-events-none text-slate-400">
                  <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              <button 
                onClick={fetchModels} 
                className="text-slate-400 hover:text-blue-400 transition-colors p-1"
                title="Refresh models"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>


          <div className="flex items-center gap-6">
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Requests</div>
                <div className="text-xs font-bold text-slate-200">{stats.requests}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Tokens</div>
                <div className="text-xs font-bold text-slate-200">{stats.estimatedTokens}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Success Rate</div>
                <div className="text-xs font-bold text-slate-200">{stats.successRate}%</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Session Time</div>
                <div className="text-xs font-bold text-slate-200">{stats.activeTime}</div>
              </div>
            </div>
          </div>
        </header>

        {activeTab === "playground" && (
          <>
            <div className="flex-grow overflow-y-auto px-8 py-8 space-y-6 custom-scrollbar">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
                  <div className="p-4 bg-blue-600/5 border border-blue-500/10 rounded-2xl">
                    <Sparkles size={36} className="text-blue-400" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold">Personal AI Gateway Chat</h2>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Start typing to test the local Gemini Web adapter connection. This UI connects directly to your Node.js instance under the hood.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg: Message, idx: number) => (
                  <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] flex gap-3.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                      <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center border ${
                        msg.role === "user" 
                          ? "bg-blue-600/10 border-blue-500/20 text-blue-400" 
                          : "bg-[#121626] border-[#1e233b] text-slate-400"
                      }`}>
                        {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
                      </div>
                      <div className={`rounded-2xl px-5 py-3.5 text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-medium shadow-lg shadow-blue-900/10"
                          : "bg-[#11131e] border border-[#1e2235] text-slate-100"
                      }`}>
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex justify-start">
                  <div className="max-w-[75%] flex gap-3.5 flex-row">
                    <div className="h-8 w-8 rounded-lg shrink-0 flex items-center justify-center border bg-[#121626] border-[#1e233b] text-slate-400">
                      <Bot size={14} />
                    </div>
                    <div className="rounded-2xl px-5 py-3.5 text-xs bg-[#11131e] border border-[#1e2235] text-slate-400 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            <div className="px-8 pb-8 bg-gradient-to-t from-[#08090e] via-[#08090e] to-transparent pt-4">
              <form onSubmit={handleSubmit} className="relative flex items-center bg-[#0c0e18] border border-[#1e233b] focus-within:border-blue-500/80 rounded-2xl p-2.5 shadow-xl shadow-black/20 transition-all duration-300">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={gatewayStatus === "online" ? "Ask Gemini anything..." : "Waiting for local Node.js server..."}
                  disabled={isLoading || gatewayStatus !== "online"}
                  className="flex-grow bg-transparent border-0 outline-none text-xs px-4 py-3 placeholder-slate-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim() || gatewayStatus !== "online"}
                  className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl p-3 text-xs font-semibold transition-all duration-300 disabled:opacity-40 disabled:hover:bg-blue-600 shrink-0"
                >
                  <Send size={14} />
                </button>
              </form>
            </div>
          </>
        )}

        {activeTab === "keys" && (
          <div className="flex-grow overflow-y-auto px-8 py-8 space-y-8 custom-scrollbar">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-[#1e233b] pb-4">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Layers size={16} className="text-blue-400" />
                    <span>Projects</span>
                  </h3>
                </div>
                
                <form onSubmit={handleCreateProject} className="flex gap-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="New project name..."
                    className="flex-grow bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-4 py-2.5 text-xs outline-none text-slate-200"
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-2.5 text-xs font-semibold transition flex items-center gap-1 shrink-0"
                  >
                    <Plus size={14} />
                    <span>Create</span>
                  </button>
                </form>

                <div className="space-y-2.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                  {projects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3.5 bg-[#121626]/50 border border-[#1e233b]/60 rounded-xl">
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-slate-200">{p.name}</div>
                        <div className="text-[9px] text-slate-500 font-mono select-all break-all">{p.id}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-[#1e233b] pb-4">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Key size={16} className="text-blue-400" />
                    <span>Generate API Key</span>
                  </h3>
                </div>

                <form onSubmit={handleCreateKey} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                      Key Description / Name
                    </label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. Production Key, Test Integration..."
                      className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-4 py-2.5 text-xs outline-none text-slate-200"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                      Target Project
                    </label>
                    <select
                      value={newKeyProjectId}
                      onChange={(e) => setNewKeyProjectId(e.target.value)}
                      className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-4 py-2.5 text-xs outline-none text-slate-200 cursor-pointer"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id} className="bg-[#0c0e18]">
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">
                        Daily Requests
                      </label>
                      <input
                        type="number"
                        value={dailyRequestsLimit}
                        onChange={(e) => setDailyRequestsLimit(e.target.value)}
                        placeholder="Unlimited"
                        className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-3 py-2 text-[11px] outline-none text-slate-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">
                        Daily Tokens
                      </label>
                      <input
                        type="number"
                        value={dailyTokensLimit}
                        onChange={(e) => setDailyTokensLimit(e.target.value)}
                        placeholder="Unlimited"
                        className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-3 py-2 text-[11px] outline-none text-slate-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">
                        RPM Rate Limit
                      </label>
                      <input
                        type="number"
                        value={rateLimitRpm}
                        onChange={(e) => setRateLimitRpm(e.target.value)}
                        placeholder="Unlimited"
                        className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-3 py-2 text-[11px] outline-none text-slate-200"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                  >
                    <PlusCircle size={14} />
                    <span>Generate Key</span>
                  </button>
                </form>
              </div>
            </div>

            <div className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6">
              <h3 className="text-sm font-bold border-b border-[#1e233b] pb-4">
                Active API Keys
              </h3>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1e233b] text-slate-500 text-[10px] uppercase font-bold tracking-wider">
                      <th className="pb-3 pr-4">Name</th>
                      <th className="pb-3 px-4">Project</th>
                      <th className="pb-3 px-4">API Key Value</th>
                      <th className="pb-3 px-4">Limits (Req/Tok/RPM)</th>
                      <th className="pb-3 px-4">Status</th>
                      <th className="pb-3 pl-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e233b]/40 text-xs">
                    {apiKeys.map((k) => (
                      <tr key={k.id} className="hover:bg-[#121626]/20 transition-colors">
                        <td className="py-4 pr-4 font-bold text-slate-200">{k.name}</td>
                        <td className="py-4 px-4 text-slate-400">{k.projects?.name || "Unknown"}</td>
                        <td className="py-4 px-4 font-mono text-[11px] text-blue-400">
                          <span className="flex items-center gap-2 select-all">
                            {k.key.substring(0, 18)}...
                            <button
                              onClick={() => copyText(k.key)}
                              className="text-slate-500 hover:text-blue-400 transition shrink-0"
                            >
                              {copiedKey === k.key ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                          </span>
                        </td>
                        <td className="py-4 px-4 text-slate-400 font-mono text-[11px]">
                          {k.daily_requests_limit || "∞"} / {k.daily_tokens_limit || "∞"} / {k.rate_limit_rpm || "∞"}
                        </td>
                        <td className="py-4 px-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            k.active ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                          }`}>
                            <span className={`h-1 w-1 rounded-full ${k.active ? "bg-emerald-400" : "bg-rose-400"}`} />
                            {k.active ? "Active" : "Disabled"}
                          </span>
                        </td>
                        <td className="py-4 pl-4 text-right">
                          <button
                            onClick={() => handleToggleKey(k.id, k.active)}
                            className={`text-[10px] font-bold tracking-wider uppercase px-3 py-1.5 rounded-lg transition border ${
                              k.active 
                                ? "border-rose-500/20 text-rose-400 hover:bg-rose-500/10" 
                                : "border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10"
                            }`}
                          >
                            {k.active ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "logs" && (
          <div className="flex-grow overflow-y-auto px-8 py-8 space-y-6 custom-scrollbar">
            <div className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6 flex flex-col h-full">
              <div className="flex items-center justify-between border-b border-[#1e233b] pb-4 shrink-0">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Terminal size={16} className="text-blue-400" />
                  <span>Real-time Rolling Analytics</span>
                </h3>
                <span className="text-[10px] text-slate-500 font-mono">Centralized Gateway Logs</span>
              </div>

              <div className="flex-grow overflow-y-auto space-y-3 custom-scrollbar pr-1">
                {recentLogs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-12">
                    <Activity size={24} className="mb-2 animate-pulse" />
                    <p className="text-xs">No gateway requests detected yet.</p>
                  </div>
                ) : (
                  recentLogs.map((l) => (
                    <div key={l.id} className="p-4 bg-[#121626]/30 border border-[#1e233b]/60 rounded-xl space-y-3 hover:border-blue-500/30 transition-all duration-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                            l.status_code >= 200 && l.status_code < 300 
                              ? "bg-emerald-500/10 text-emerald-400" 
                              : "bg-rose-500/10 text-rose-400"
                          }`}>
                            {l.status_code}
                          </span>
                          <span className="text-xs font-bold text-slate-200 font-mono">{l.model}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                          <Clock size={10} />
                          {new Date(l.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1.5 text-[10px] font-mono text-slate-400 border-t border-[#1e233b]/30">
                        <div>
                          <span className="text-slate-500 uppercase block text-[8px] font-bold">Project</span>
                          <span className="text-slate-300 font-semibold">{l.projects?.name || "N/A"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 uppercase block text-[8px] font-bold">API Key</span>
                          <span className="text-slate-300 font-semibold">{l.api_keys?.name || "N/A"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 uppercase block text-[8px] font-bold">Tokens</span>
                          <span className="text-slate-300 font-semibold">{l.total_tokens} total</span>
                        </div>
                        <div>
                          <span className="text-slate-500 uppercase block text-[8px] font-bold">Latency</span>
                          <span className="text-slate-300 font-semibold">{l.duration_ms}ms</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "faq" && (
          <div className="flex-grow overflow-y-auto px-8 py-8 space-y-8 custom-scrollbar">
            {/* Header banner */}
            <div className="relative overflow-hidden bg-gradient-to-r from-blue-600/10 via-indigo-600/5 to-transparent border border-blue-500/20 rounded-2xl p-6 shadow-lg">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-500/15 border border-blue-500/20 rounded-xl text-blue-400 shrink-0">
                  <HelpCircle size={24} />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-100">Инструкция по добавлению cookie</h2>
                  <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
                    Для полноценной работы с Google Gemini Pro и обхода ограничений стандартного API, вы можете использовать авторизационные куки Google сессии. Следуйте шагам ниже, чтобы извлечь их и настроить совместимость.
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Warning/Notice */}
            <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/15 rounded-xl">
              <Lock size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 leading-normal">
                <strong className="text-amber-400">Важная безопасность:</strong> Мы никогда не храним ваши куки централизованно. Они передаются напрямую в заголовке авторизации вашего запроса, гарантируя, что ваш Google аккаунт остается полностью под вашим контролем.
              </div>
            </div>

            {/* Grid Layout for Guide & Contents */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              {/* Left sidebar: Steps Quick Navigation */}
              <div className="lg:col-span-1 space-y-3">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 px-2">Содержание</div>
                <nav className="space-y-1">
                  {[
                    { id: "step-extract", label: "1. Как получить Cookie" },
                    { id: "step-auth", label: "2. Передача как API Key" },
                    { id: "step-clients", label: "3. Настройка в клиентах" },
                    { id: "step-config", label: "4. Настройка на сервере" },
                    { id: "step-test", label: "5. Проверить куки онлайн" },
                    { id: "step-trouble", label: "6. Частые проблемы" },
                  ].map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="block px-3 py-2 text-xs text-slate-400 hover:text-blue-400 rounded-lg hover:bg-slate-800/20 transition-all font-medium"
                    >
                      {item.label}
                    </a>
                  ))}
                </nav>
              </div>


              {/* Right: Detailed Content */}
              <div className="lg:col-span-3 space-y-10">
                {/* Step 1: Extract Cookies */}
                <section id="step-extract" className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6 scroll-mt-6">
                  <div className="border-b border-[#1e233b] pb-4 flex items-center gap-2">
                    <BookOpen size={18} className="text-blue-400" />
                    <h3 className="text-sm font-bold text-slate-100">1. Как извлечь cookie из браузера</h3>
                  </div>

                  <div className="space-y-4 text-xs text-slate-300">
                    <p className="leading-relaxed">
                      Для извлечения кук вам понадобится браузер Chrome, Firefox или любой другой на базе Chromium.
                    </p>

                    <div className="relative border-l-2 border-blue-500/30 pl-4 space-y-4 py-1">
                      <div className="space-y-1">
                        <div className="font-bold text-slate-200">Шаг 1: Авторизация в Gemini</div>
                        <p className="text-slate-400">
                          Перейдите на сайт <a href="https://gemini.google.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">gemini.google.com <ExternalLink size={10} /></a> и войдите под своей учетной записью Google.
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="font-bold text-slate-200">Шаг 2: Открытие инструментов разработчика</div>
                        <p className="text-slate-400">
                          Нажмите клавишу <kbd className="px-1.5 py-0.5 bg-[#121626] border border-[#1e233b] rounded text-[10px] font-mono text-slate-300">F12</kbd> (или нажмите правой кнопкой мыши в любом месте страницы и выберите «Исследовать элемент / Посмотреть код»).
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="font-bold text-slate-200">Шаг 3: Поиск cookies</div>
                        <p className="text-slate-400">
                          В верхней панели инструментов разработчика выберите вкладку <strong className="text-slate-200">«Application»</strong> (Приложение) ➔ в левом меню разверните список <strong className="text-slate-200">«Cookies»</strong> ➔ выберите <strong className="text-blue-400">https://gemini.google.com</strong>.
                        </p>
                      </div>

                      <div className="space-y-1">
                        <div className="font-bold text-slate-200">Шаг 4: Копирование параметров</div>
                        <p className="text-slate-400 mb-2">Найдите в таблице следующие ключи и скопируйте их значения:</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                          <div className="p-3 bg-[#121626] border border-[#1e233b] rounded-xl">
                            <span className="font-mono text-blue-400 font-bold block text-[10px]">__Secure-1PSID</span>
                            <span className="text-[10px] text-slate-500">Основной токен сессии (обязательно)</span>
                          </div>
                          <div className="p-3 bg-[#121626] border border-[#1e233b] rounded-xl">
                            <span className="font-mono text-blue-400 font-bold block text-[10px]">SID</span>
                            <span className="text-[10px] text-slate-500">Идентификатор сессии (обязательно)</span>
                          </div>
                          <div className="p-3 bg-[#121626] border border-[#1e233b] rounded-xl">
                            <span className="font-mono text-blue-400 font-bold block text-[10px]">SAPISID</span>
                            <span className="text-[10px] text-slate-500">Подпись API запросов (обязательно)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Step 2: Use as Bearer Auth */}
                <section id="step-auth" className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6 scroll-mt-6">
                  <div className="border-b border-[#1e233b] pb-4 flex items-center gap-2">
                    <Key size={18} className="text-blue-400" />
                    <h3 className="text-sm font-bold text-slate-100">2. Передача Cookie как API-ключа (Bearer Authorization)</h3>
                  </div>

                  <div className="space-y-4 text-xs text-slate-300">
                    <p className="leading-relaxed">
                      Наш шлюз спроектирован так, что вы можете передавать свои куки напрямую вместо стандартного API-ключа в любом OpenAI-совместимом приложении!
                    </p>
                    <p className="leading-relaxed">
                      Для этого соберите строку ваших кук в следующем формате (через точку с запятой):
                    </p>

                    <div className="relative bg-[#121626] border border-[#1e233b] rounded-xl p-4 font-mono text-[11px] text-slate-300 break-all select-all flex justify-between items-center gap-4">
                      <span>
                        SID=<span className="text-blue-400">ваш_SID</span>; SAPISID=<span className="text-blue-400">ваш_SAPISID</span>; __Secure-1PSID=<span className="text-blue-400">ваш___Secure-1PSID</span>;
                      </span>
                      <button
                        type="button"
                        onClick={() => copyGuideText("SID=your_sid; SAPISID=your_sapisid; __Secure-1PSID=your_1psid;", "cookie-format")}
                        className="text-slate-500 hover:text-blue-400 transition shrink-0 p-1 bg-slate-800/30 rounded"
                        title="Скопировать шаблон"
                      >
                        {copiedId === "cookie-format" ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                      </button>
                    </div>

                    <div className="flex items-center gap-2.5 p-3.5 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                      <Info size={14} className="text-blue-400 shrink-0" />
                      <span>
                        Передавайте эту собранную строку в заголовке: <code className="text-blue-400 font-mono text-[10px] bg-blue-950/20 px-1 py-0.5 rounded">Authorization: Bearer SID=...; SAPISID=...; __Secure-1PSID=...</code>
                      </span>
                    </div>
                  </div>
                </section>
                {/* Step 3: Client Configs */}
                <section id="step-clients" className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6 scroll-mt-6">
                  <div className="border-b border-[#1e233b] pb-4 flex items-center gap-2">
                    <FileText size={18} className="text-blue-400" />
                    <h3 className="text-sm font-bold text-slate-100">3. Настройка в сторонних клиентах и IDE</h3>
                  </div>

                  <div className="space-y-6 text-xs text-slate-300">
                    <p className="leading-relaxed text-slate-400">
                      Наш шлюз полностью совместим с OpenAI API, что позволяет интегрировать его практически в любого клиента, среду разработки (IDE) или инструмент автодополнения кода. Выберите интересующий вас инструмент и платформу.
                    </p>

                    {/* Provider Selectors */}
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase font-extrabold tracking-wider text-slate-500">Провайдер / Интеграция</div>
                      <div className="flex flex-wrap gap-1 p-1 bg-[#121626] border border-[#1e233b] rounded-xl">
                        {[
                          { id: "opencode", name: "OpenCode" },
                          { id: "vscode", name: "VS Code" },
                          { id: "codex", name: "Codex" },
                          { id: "codex_cli", name: "Codex CLI" },
                          { id: "openclaw", name: "OpenClaw" },
                          { id: "cursor", name: "Cursor" },
                          { id: "jetbrains", name: "JetBrains" },
                          { id: "zed", name: "Zed" }
                        ].map((prov) => (
                          <button
                            key={prov.id}
                            type="button"
                            onClick={() => setActiveProvider(prov.id as any)}
                            className={`px-3 py-2 rounded-lg text-[10px] font-bold tracking-wide transition ${
                              activeProvider === prov.id
                                ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                            }`}
                          >
                            {prov.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Platform Selectors */}
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase font-extrabold tracking-wider text-slate-500">Платформа / ОС</div>
                      <div className="flex gap-1 p-1 bg-[#121626] border border-[#1e233b] rounded-xl max-w-xs">
                        {[
                          { id: "windows", name: "Windows" },
                          { id: "macos", name: "macOS" },
                          { id: "linux", name: "Linux" }
                        ].map((plat) => (
                          <button
                            key={plat.id}
                            type="button"
                            onClick={() => setActivePlatform(plat.id as any)}
                            className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-bold tracking-wide transition ${
                              activePlatform === plat.id
                                ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                            }`}
                          >
                            {plat.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Dynamic content rendering based on activeProvider */}
                    {activeProvider === "opencode" ? (
                      <div className="space-y-5 pt-2">
                        <div className="space-y-2">
                          <h4 className="font-bold text-slate-200">Настройка в NextChat / LobeChat / др.</h4>
                          <p className="text-slate-400 leading-relaxed">
                            В настройках любого OpenAI-совместимого веб-интерфейса или приложения укажите:
                          </p>
                          <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
                            <li><strong className="text-slate-300">Base URL:</strong> <code className="text-blue-400 font-mono">http://localhost:3000/api/v1</code> (или внешний адрес вашего шлюза)</li>
                            <li><strong className="text-slate-300">API Key:</strong> <code className="text-blue-400 font-mono">SID=ваш_SID; SAPISID=ваш_SAPISID; __Secure-1PSID=ваш___Secure-1PSID;</code></li>
                          </ul>
                        </div>

                        <div className="space-y-2.5">
                          <h4 className="font-bold text-slate-200">Настройка через файл opencode.json</h4>
                          <p className="text-slate-400 leading-relaxed">
                            {activePlatform === "windows" && (
                              <span>Файл конфигурации расположен по пути: <code className="text-slate-300 font-mono bg-slate-900/40 px-1 py-0.5 rounded">%USERPROFILE%\.opencode\opencode.json</code>.</span>
                            )}
                            {activePlatform === "macos" && (
                              <span>Файл конфигурации расположен по пути: <code className="text-slate-300 font-mono bg-slate-900/40 px-1 py-0.5 rounded">~/.opencode/opencode.json</code>.</span>
                            )}
                            {activePlatform === "linux" && (
                              <span>Файл конфигурации расположен по пути: <code className="text-slate-300 font-mono bg-slate-900/40 px-1 py-0.5 rounded">~/.opencode/opencode.json</code>.</span>
                            )}
                            {" "}Используйте следующий шаблон структуры провайдера:
                          </p>
                          <div className="relative bg-[#121626] border border-[#1e233b] rounded-xl p-4 font-mono text-[11px] text-slate-300 block">
                            <pre className="overflow-x-auto text-[10px] leading-relaxed select-all">
{`{
  "providers": [
    {
      "id": "gemini-web-gateway",
      "name": "Gemini Web Proxy",
      "api_type": "openai",
      "api_url": "http://localhost:3000/api/v1",
      "api_key": "SID=your_sid_here; SAPISID=your_sapisid_here; __Secure-1PSID=your_secure_1psid_here;",
      "models": ["gemini-3.5-flash", "gemini-3.1-pro"]
    }
  ]
}`}
                            </pre>
                            <button
                              type="button"
                              onClick={() => copyGuideText(`{\n  "providers": [\n    {\n      "id": "gemini-web-gateway",\n      "name": "Gemini Web Proxy",\n      "api_type": "openai",\n      "api_url": "http://localhost:3000/api/v1",\n      "api_key": "SID=your_sid_here; SAPISID=your_sapisid_here; __Secure-1PSID=your_secure_1psid_here;",\n      "models": ["gemini-3.5-flash", "gemini-3.1-pro"]\n    }\n  ]\n}`, "opencode-json")}
                              className="absolute top-4 right-4 text-slate-500 hover:text-blue-400 transition shrink-0 p-1 bg-slate-800/30 rounded"
                              title="Скопировать JSON"
                            >
                              {copiedId === "opencode-json" ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center p-8 bg-[#121626]/40 border border-[#1e233b]/60 border-dashed rounded-xl space-y-4 pt-6">
                        <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl text-blue-400 animate-pulse">
                          <Code size={24} />
                        </div>
                        <div className="space-y-1">
                          <h4 className="font-bold text-slate-200">
                            Подключение {
                              activeProvider === "vscode" ? "VS Code" :
                              activeProvider === "codex" ? "Codex" :
                              activeProvider === "codex_cli" ? "Codex CLI" :
                              activeProvider === "openclaw" ? "OpenClaw" :
                              activeProvider === "cursor" ? "Cursor" :
                              activeProvider === "jetbrains" ? "JetBrains" :
                              "Zed"
                            } на {
                              activePlatform === "windows" ? "Windows" :
                              activePlatform === "macos" ? "macOS" :
                              "Linux"
                            }
                          </h4>
                          <p className="text-[11px] text-slate-400 max-w-sm leading-relaxed">
                            Инструкция по настройке {
                              activeProvider === "vscode" ? "расширения VS Code" :
                              activeProvider === "codex" ? "клиента Codex" :
                              activeProvider === "codex_cli" ? "утилиты Codex CLI" :
                              activeProvider === "openclaw" ? "клиента OpenClaw" :
                              activeProvider === "cursor" ? "редактора Cursor" :
                              activeProvider === "jetbrains" ? "плагинов JetBrains IDE" :
                              "редактора Zed"
                            } для этой платформы находится в процессе наполнения (заглушка).
                          </p>
                        </div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400">
                          TODO: Доделать подключение
                        </span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Step 4: Server configurations */}
                <section id="step-config" className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6 scroll-mt-6">
                  <div className="border-b border-[#1e233b] pb-4 flex items-center gap-2">
                    <Settings size={18} className="text-blue-400" />
                    <h3 className="text-sm font-bold text-slate-100">4. Настройка централизованно на сервере</h3>
                  </div>

                  <div className="space-y-4 text-xs text-slate-300">
                    <p className="leading-relaxed">
                      Если вы хотите развернуть шлюз с общими куками для всех ваших ключей, вы можете настроить файл `cookie.txt` в корне проекта или прописать конфигурацию в файле `config.json` шлюза.
                    </p>

                    <div className="space-y-2">
                      <h4 className="font-bold text-slate-200">Способ A: Создание cookie.txt</h4>
                      <p className="text-slate-400">
                        Создайте файл с именем <code className="text-blue-400 font-mono">cookie.txt</code> в папке шлюза и поместите туда одну строку с куками:
                      </p>
                      <div className="relative bg-[#121626] border border-[#1e233b] rounded-xl p-4 font-mono text-[11px] text-slate-300 break-all select-all flex justify-between items-center gap-4">
                        <span>SID=your_sid; HSID=your_hsid; SSID=your_ssid; SAPISID=your_sapisid; __Secure-1PSID=your_1psid;</span>
                        <button
                          type="button"
                          onClick={() => copyGuideText("SID=your_sid; HSID=your_hsid; SSID=your_ssid; SAPISID=your_sapisid; __Secure-1PSID=your_1psid;", "cookie-txt-format")}
                          className="text-slate-500 hover:text-blue-400 transition shrink-0 p-1 bg-slate-800/30 rounded"
                          title="Скопировать"
                        >
                          {copiedId === "cookie-txt-format" ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-bold text-slate-200">Способ B: Формат JSON конфигурации (config.json)</h4>
                      <p className="text-slate-400">
                        Или укажите куки в конфигурации в следующем формате:
                      </p>
                      <div className="relative bg-[#121626] border border-[#1e233b] rounded-xl p-4 font-mono text-[11px] text-slate-300 block">
                        <pre className="overflow-x-auto text-[10px] leading-relaxed select-all">
{`{
  "cookie": "SID=xxx; HSID=xxx; SSID=xxx; APISID=xxx; SAPISID=xxx; __Secure-1PSID=xxx",
  "sapisid": "your_sapisid_value"
}`}
                        </pre>
                        <button
                          type="button"
                          onClick={() => copyGuideText(`{\n  "cookie": "SID=xxx; HSID=xxx; SSID=xxx; APISID=xxx; SAPISID=xxx; __Secure-1PSID=xxx",\n  "sapisid": "your_sapisid_value"\n}`, "config-json-format")}
                          className="absolute top-4 right-4 text-slate-500 hover:text-blue-400 transition shrink-0 p-1 bg-slate-800/30 rounded"
                          title="Скопировать JSON"
                        >
                          {copiedId === "config-json-format" ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Step 5: Test Cookie Online */}
                <section id="step-test" className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6 scroll-mt-6">
                  <div className="border-b border-[#1e233b] pb-4 flex items-center gap-2">
                    <Activity size={18} className="text-blue-400" />
                    <h3 className="text-sm font-bold text-slate-100">5. Онлайн-проверка cookie</h3>
                  </div>

                  <div className="space-y-4 text-xs text-slate-300">
                    <p className="leading-relaxed">
                      Вы можете проверить валидность полученной строки cookies в реальном времени. Вставьте собранную строку или JSON-объект ниже и нажмите кнопку «Проверить».
                    </p>

                    <div className="space-y-3">
                      <textarea
                        value={cookieTestInput}
                        onChange={(e) => setCookieTestInput(e.target.value)}
                        placeholder="Вставьте ваши cookie (например, SID=...; SAPISID=...; __Secure-1PSID=...;)"
                        rows={3}
                        className="w-full bg-[#121626] border border-[#1e233b] hover:border-blue-500/50 focus:border-blue-500/80 rounded-xl px-4 py-3 text-xs outline-none text-slate-200 font-mono resize-y transition"
                      />
                      
                      <div className="flex justify-between items-center">
                        <button
                          type="button"
                          onClick={handleTestCookie}
                          disabled={isTestingCookie || !cookieTestInput.trim()}
                          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl px-5 py-2.5 text-xs font-semibold transition flex items-center gap-2"
                        >
                          {isTestingCookie ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" />
                              <span>Проверка...</span>
                            </>
                          ) : (
                            <span>Проверить cookie</span>
                          )}
                        </button>
                        
                        {testResult && (
                          <div className={`px-4 py-2.5 rounded-xl border text-[11px] font-semibold flex items-center gap-2 ${
                            testResult.success 
                              ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400" 
                              : "bg-rose-500/5 border-rose-500/20 text-rose-400"
                          }`}>
                            <span className={`h-2 w-2 rounded-full ${testResult.success ? "bg-emerald-500" : "bg-rose-500"}`} />
                            <span>{testResult.message}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Step 6: Troubleshooting / Частые проблемы */}
                <section id="step-trouble" className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6 scroll-mt-6">
                  <div className="border-b border-[#1e233b] pb-4 flex items-center gap-2">
                    <Shield size={18} className="text-blue-400" />
                    <h3 className="text-sm font-bold text-slate-100">6. Частые проблемы и решения</h3>
                  </div>

                  <div className="space-y-6 text-xs text-slate-300">
                    <div className="space-y-2 border-b border-[#1e233b]/30 pb-4">
                      <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span className="text-amber-400">1.</span> Ошибка &quot;Cookie expired or invalid&quot;
                      </h4>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Причина:</strong> Срок действия куки Google истёк (обычно сессия живет от 7 до 30 дней).
                      </p>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Решение:</strong> Перейдите на <a href="https://gemini.google.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">gemini.google.com</a>, войдите заново, затем откройте инструменты разработчика и скопируйте обновленные значения cookie.
                      </p>
                    </div>

                    <div className="space-y-2 border-b border-[#1e233b]/30 pb-4">
                      <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span className="text-amber-400">2.</span> Ошибка &quot;Rate limit exceeded&quot;
                      </h4>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Причина:</strong> Превышено стандартное ограничение по количеству запросов (по умолчанию 15 запросов в минуту).
                      </p>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Решение:</strong> Подождите 60 секунд перед отправкой следующего запроса. Также вы можете настроить индивидуальный лимит RPM для сгенерированных API-ключей в разделе <strong>Projects &amp; API Keys</strong>.
                      </p>
                    </div>

                    <div className="space-y-2 border-b border-[#1e233b]/30 pb-4">
                      <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span className="text-amber-400">3.</span> Ошибка &quot;Invalid cookie format&quot;
                      </h4>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Причина:</strong> Скопированы не все требуемые сессионные параметры.
                      </p>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Решение:</strong> Убедитесь, что строка cookies содержит хотя бы <code className="text-blue-400 font-mono text-[10px] bg-slate-900/40 px-1 py-0.5 rounded">__Secure-1PSID</code> или комбинацию <code className="text-blue-400 font-mono text-[10px] bg-slate-900/40 px-1 py-0.5 rounded">SID</code> + <code className="text-blue-400 font-mono text-[10px] bg-slate-900/40 px-1 py-0.5 rounded">SAPISID</code>.
                      </p>
                    </div>

                    <div className="space-y-3 border-b border-[#1e233b]/30 pb-4">
                      <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span className="text-amber-400">4.</span> OpenCode не подключается
                      </h4>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Причина:</strong> Неверный адрес <code className="text-slate-200 font-mono bg-slate-900/40 px-1 py-0.5 rounded">baseURL</code> или ключ авторизации.
                      </p>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Решение:</strong> Проверьте файл конфигурации <code className="text-slate-200 font-mono bg-slate-900/40 px-1 py-0.5 rounded">opencode.json</code>. Убедитесь, что провайдер настроен так:
                      </p>
                      <div className="relative bg-[#121626] border border-[#1e233b] rounded-xl p-4 font-mono text-[10px] text-slate-300 block ml-5">
                        <pre className="overflow-x-auto leading-relaxed select-all">
{`{
  "provider": {
    "gemini-web2api": {
      "options": {
        "baseURL": "http://localhost:8081/v1",
        "apiKey": "SID=your_sid; __Secure-1PSID=your_secure_psid..."
      }
    }
  }
}`}
                        </pre>
                        <button
                          type="button"
                          onClick={() => copyGuideText(`{\n  "provider": {\n    "gemini-web2api": {\n      "options": {\n        "baseURL": "http://localhost:8081/v1",\n        "apiKey": "SID=your_sid; __Secure-1PSID=your_secure_psid..."\n      }\n    }\n  }\n}`, "opencode-trouble-json")}
                          className="absolute top-4 right-4 text-slate-500 hover:text-blue-400 transition shrink-0 p-1 bg-slate-800/30 rounded"
                          title="Скопировать"
                        >
                          {copiedId === "opencode-trouble-json" ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                        <span className="text-amber-400">5.</span> Локальный шлюз (сервер) не запускается
                      </h4>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Причина:</strong> Порт 8081 (или настроенный порт) уже занят другим приложением на компьютере.
                      </p>
                      <p className="text-slate-400 leading-relaxed pl-5">
                        <strong>Решение:</strong> Измените параметр <code className="text-slate-200 font-mono bg-slate-900/40 px-1 py-0.5 rounded">&quot;port&quot;: 8081</code> в файле <code className="text-slate-200 font-mono bg-slate-900/40 px-1 py-0.5 rounded">config.json</code> на любой другой свободный порт или завершите процесс, который занимает этот порт.
                      </p>
                    </div>
                  </div>
                </section>
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}
