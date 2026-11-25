"use client";

import React, { useState } from "react";
import { Copy, Check, Plus, Trash2, Key, Cookie, Terminal, RefreshCw, ShieldCheck, AlertTriangle } from "lucide-react";
import { translations, Language } from "../utils/i18n";

export interface ProjectItem {
  id: string;
  name: string;
  created_at: string;
}

export interface ApiKeyItem {
  id: string;
  key: string;
  project_id: string;
  name: string;
  active: boolean;
  projects?: { name: string };
  daily_requests_limit?: number | null;
  daily_tokens_limit?: number | null;
  rate_limit_rpm?: number | null;
  temporary_chats?: boolean;
  expires_at?: string | null;
  created_at: string;
}

export interface CookieStatusData {
  hasFile: boolean;
  isValid: boolean | null;
  cookies: Record<string, boolean>;
  requiredCookies: Array<{ name: string; required: boolean; desc: string }>;
}

interface ConnectTabProps {
  gatewayUrl: string;
  models: string[];
  selectedModel: string;
  projects: ProjectItem[];
  apiKeys: ApiKeyItem[];
  activeKey: string;
  setActiveKey: (key: string) => void;
  onCreateProject: (name: string) => Promise<void>;
  onCreateKey: (payload: {
    name: string;
    project_id: string;
    expires_at: string | null;
    rate_limit_rpm: number | null;
    daily_requests_limit: number | null;
    daily_tokens_limit: number | null;
    temporary_chats: boolean;
  }) => Promise<void>;
  onToggleKey: (id: string, active: boolean) => Promise<void>;
  onToggleTemporaryChats: (id: string, current: boolean) => Promise<void>;
  onDeleteKey: (id: string) => Promise<void>;
  cookieStatus: CookieStatusData | null;
  onSaveCookie: (cookieStr: string) => Promise<{ success: boolean; message: string }>;
  lang: Language;
}

type ClientId =
  | "opencode"
  | "cursor"
  | "vscode"
  | "gemini_cli"
  | "zed"
  | "jetbrains"
  | "openclaw"
  | "curl"
  | "python"
  | "env";
type OsType = "windows" | "macos" | "linux";

function CopyButton({ value, copyLabel, copiedLabel }: { value: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!value}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#171a22] hover:bg-[#222633] border border-[#222633] text-xs text-[#c5cbe0] hover:text-white transition-colors shrink-0 disabled:opacity-40"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      <span>{copied ? copiedLabel : copyLabel}</span>
    </button>
  );
}

export default function ConnectTab({
  gatewayUrl,
  models,
  selectedModel,
  projects,
  apiKeys,
  activeKey,
  setActiveKey,
  onCreateProject,
  onCreateKey,
  onToggleKey,
  onToggleTemporaryChats,
  onDeleteKey,
  cookieStatus,
  onSaveCookie,
  lang
}: ConnectTabProps) {
  const t = translations[lang];
  const cleanRootUrl = gatewayUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const openAiBaseUrl = `${cleanRootUrl}/v1`;
  const effectiveModel = selectedModel || models[0] || "gemini-4-hydrogen";

  // Client presets state
  const [client, setClient] = useState<ClientId>("cursor");
  const [os, setOs] = useState<OsType>("windows");

  // New key / project form state
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyProjectId, setNewKeyProjectId] = useState(projects[0]?.id || "00000000-0000-0000-0000-000000000000");
  const [expiration, setExpiration] = useState("never");
  const [rpmLimit, setRpmLimit] = useState("");
  const [dailyReqLimit, setDailyReqLimit] = useState("");
  const [dailyTokLimit, setDailyTokLimit] = useState("");
  const [temporaryChats, setTemporaryChats] = useState(true);
  const [newProjectName, setNewProjectName] = useState("");
  const [showProjectInput, setShowProjectInput] = useState(false);

  // Cookie state
  const [cookieInput, setCookieInput] = useState("");
  const [isSavingCookie, setIsSavingCookie] = useState(false);
  const [cookieFeedback, setCookieFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const getSnippet = (): { hint?: string; code: string } => {
    switch (client) {
      case "opencode": {
        const cfgPath =
          os === "windows" ? "%USERPROFILE%\\.config\\opencode\\opencode.json" : "~/.config/opencode/opencode.json";
        const modelsObj = (models.length > 0 ? models : [effectiveModel]).reduce<Record<string, { name: string }>>(
          (acc, m) => {
            acc[m] = { name: `${m} (Gateway)` };
            return acc;
          },
          {}
        );
        return {
          hint: cfgPath,
          code: JSON.stringify(
            {
              provider: {
                "gemini-web2api": {
                  npm: "@ai-sdk/openai-compatible",
                  name: "Gemini Gateway",
                  options: { baseURL: openAiBaseUrl, apiKey: activeKey },
                  models: modelsObj
                }
              }
            },
            null,
            2
          )
        };
      }
      case "cursor":
        return {
          hint: "Cursor → Settings → Models → Override OpenAI Base URL",
          code: `Base URL: ${openAiBaseUrl}\nAPI Key:  ${activeKey}\nModel:    ${effectiveModel}`
        };
      case "vscode": {
        const cfgPath = os === "windows" ? "%USERPROFILE%\\.continue\\config.json" : "~/.continue/config.json";
        return {
          hint: cfgPath,
          code: JSON.stringify(
            {
              models: [
                {
                  title: "Gemini Gateway",
                  provider: "openai",
                  model: effectiveModel,
                  apiBase: openAiBaseUrl,
                  apiKey: activeKey
                }
              ]
            },
            null,
            2
          )
        };
      }
      case "gemini_cli":
        return {
          hint: "Google Native /v1beta endpoint",
          code:
            os === "windows"
              ? `$env:GEMINI_API_KEY="${activeKey}"\n$env:GOOGLE_GEMINI_BASE_URL="${cleanRootUrl}"\ngemini`
              : `export GEMINI_API_KEY="${activeKey}"\nexport GOOGLE_GEMINI_BASE_URL="${cleanRootUrl}"\ngemini`
        };
      case "zed": {
        const cfgPath = os === "windows" ? "%USERPROFILE%\\.config\\zed\\settings.json" : "~/.config/zed/settings.json";
        return {
          hint: cfgPath,
          code: JSON.stringify(
            {
              language_models: {
                openai: {
                  api_url: openAiBaseUrl,
                  api_key: activeKey,
                  available_models: models.length > 0 ? models : [effectiveModel]
                }
              }
            },
            null,
            2
          )
        };
      }
      case "jetbrains":
        return {
          hint: "Settings → Tools → AI Assistant / Custom OpenAI Endpoint",
          code: `API URL: ${openAiBaseUrl}\nAPI Key: ${activeKey}\nModel:   ${effectiveModel}`
        };
      case "openclaw":
        return {
          hint: "openclaw.toml",
          code: `[provider.gemini_web2api]\napi_type = "openai"\napi_base = "${openAiBaseUrl}"\napi_key = "${activeKey}"\nmodels = [${(models.length > 0 ? models : [effectiveModel]).map((m) => `"${m}"`).join(", ")}]`
        };
      case "curl":
        return {
          code: `curl ${openAiBaseUrl}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${activeKey}" \\\n  -d '{\n    "model": "${effectiveModel}",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`
        };
      case "python":
        return {
          code: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${openAiBaseUrl}",\n    api_key="${activeKey}"\n)\n\nresp = client.chat.completions.create(\n    model="${effectiveModel}",\n    messages=[{"role": "user", "content": "Hello!"}]\n)\nprint(resp.choices[0].message.content)`
        };
      case "env":
        return {
          code: `OPENAI_BASE_URL=${openAiBaseUrl}\nOPENAI_API_KEY=${activeKey}\nOPENAI_MODEL=${effectiveModel}`
        };
    }
  };

  const snippet = getSnippet();
  const needsOsToggle = client === "opencode" || client === "vscode" || client === "zed" || client === "gemini_cli";

  const handleKeyFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    let expiresAt: string | null = null;
    if (expiration !== "never") {
      const d = new Date();
      if (expiration === "1h") d.setHours(d.getHours() + 1);
      else if (expiration === "24h") d.setHours(d.getHours() + 24);
      else if (expiration === "7d") d.setDate(d.getDate() + 7);
      else if (expiration === "30d") d.setDate(d.getDate() + 30);
      else if (expiration === "90d") d.setDate(d.getDate() + 90);
      expiresAt = d.toISOString();
    }

    await onCreateKey({
      name: newKeyName.trim(),
      project_id: newKeyProjectId || projects[0]?.id || "00000000-0000-0000-0000-000000000000",
      expires_at: expiresAt,
      rate_limit_rpm: rpmLimit ? parseInt(rpmLimit, 10) : null,
      daily_requests_limit: dailyReqLimit ? parseInt(dailyReqLimit, 10) : null,
      daily_tokens_limit: dailyTokLimit ? parseInt(dailyTokLimit, 10) : null,
      temporary_chats: temporaryChats
    });

    setNewKeyName("");
    setRpmLimit("");
    setDailyReqLimit("");
    setDailyTokLimit("");
    setTemporaryChats(true);
    setExpiration("never");
    setShowKeyForm(false);
  };

  const handleProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    await onCreateProject(newProjectName.trim());
    setNewProjectName("");
    setShowProjectInput(false);
  };

  const handleCookieSubmit = async () => {
    if (!cookieInput.trim() || isSavingCookie) return;
    setIsSavingCookie(true);
    setCookieFeedback(null);
    try {
      const res = await onSaveCookie(cookieInput.trim());
      setCookieFeedback(res);
      if (res.success) {
        setCookieInput("");
      }
    } finally {
      setIsSavingCookie(false);
    }
  };

  const clientTabs: Array<{ id: ClientId; label: string }> = [
    { id: "cursor", label: "Cursor" },
    { id: "opencode", label: "OpenCode" },
    { id: "vscode", label: "VS Code" },
    { id: "gemini_cli", label: "Gemini CLI" },
    { id: "zed", label: "Zed" },
    { id: "jetbrains", label: "JetBrains" },
    { id: "openclaw", label: "OpenClaw" },
    { id: "curl", label: "cURL" },
    { id: "python", label: "Python" },
    { id: "env", label: ".env" }
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-20 md:pb-8 bg-[#0a0b0e] custom-scrollbar">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 1. Connection Endpoints (Single Canonical Place) */}
        <section className="rounded-xl bg-[#111319] border border-[#222633] p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[#eceef4]">{t.connectTitle}</h3>
            <p className="text-xs text-[#8e95a8] mt-0.5">{t.connectSubtitle}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg bg-[#0d0f14] border border-[#222633] p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-[#8e95a8]">{t.openAiBaseUrl}</div>
                <div className="text-xs font-mono text-[#eceef4] truncate mt-0.5">{openAiBaseUrl}</div>
              </div>
              <CopyButton value={openAiBaseUrl} copyLabel={t.copyBtn} copiedLabel={t.copied} />
            </div>

            <div className="rounded-lg bg-[#0d0f14] border border-[#222633] p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-[#8e95a8]">{t.googleBaseUrl}</div>
                <div className="text-xs font-mono text-[#eceef4] truncate mt-0.5">{cleanRootUrl}</div>
              </div>
              <CopyButton value={cleanRootUrl} copyLabel={t.copyBtn} copiedLabel={t.copied} />
            </div>
          </div>

          <div className="rounded-lg bg-[#0d0f14] border border-[#222633] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <label htmlFor="active-key-select" className="block text-[11px] text-[#8e95a8]">
                {t.activeKeyLabel}
              </label>
              <select
                id="active-key-select"
                value={activeKey}
                onChange={(e) => setActiveKey(e.target.value)}
                className="w-full bg-[#171a22] border border-[#222633] rounded-md px-2.5 py-1.5 text-xs font-mono text-[#eceef4] outline-none"
              >
                {apiKeys.filter((k) => k.active).length === 0 ? (
                  <option value={activeKey}>{activeKey || "sk-personal-gw"}</option>
                ) : (
                  apiKeys
                    .filter((k) => k.active)
                    .map((k) => (
                      <option key={k.id} value={k.key}>
                        {k.name} ({k.key.slice(0, 16)}...)
                      </option>
                    ))
                )}
              </select>
            </div>
            <div className="pt-0 sm:pt-4">
              <CopyButton value={activeKey} copyLabel={t.copyBtn} copiedLabel={t.copied} />
            </div>
          </div>
        </section>

        {/* 2. Client Presets */}
        <section className="rounded-xl bg-[#111319] border border-[#222633] p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#eceef4] flex items-center gap-2">
                <Terminal size={15} className="text-[#4f8cff]" />
                <span>{t.presetsTitle}</span>
              </h3>
              <p className="text-xs text-[#8e95a8] mt-0.5">{t.presetsSubtitle}</p>
            </div>

            {needsOsToggle ? (
              <div className="inline-flex items-center rounded-lg bg-[#0d0f14] border border-[#222633] p-0.5 self-start">
                {(["windows", "macos", "linux"] as OsType[]).map((plat) => (
                  <button
                    key={plat}
                    type="button"
                    onClick={() => setOs(plat)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                      os === plat ? "bg-[#4f8cff]/20 text-[#eceef4]" : "text-[#8e95a8] hover:text-[#eceef4]"
                    }`}
                  >
                    {plat === "macos" ? "macOS" : plat}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {clientTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setClient(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  client === item.id
                    ? "bg-[#4f8cff]/15 text-[#eceef4] border border-[#4f8cff]/35"
                    : "bg-[#0d0f14] text-[#8e95a8] hover:text-[#eceef4] border border-[#222633]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-[#0a0b0e] border border-[#222633] overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2 bg-[#0d0f14] border-b border-[#222633]">
              <span className="text-xs font-mono text-[#8e95a8] truncate">{snippet.hint || client}</span>
              <CopyButton value={snippet.code} copyLabel={t.copyBtn} copiedLabel={t.copied} />
            </div>
            <pre className="p-4 text-xs font-mono text-[#d9dde8] overflow-x-auto leading-relaxed custom-scrollbar select-all">
              {snippet.code}
            </pre>
          </div>
        </section>

        {/* 3. API Keys & Projects */}
        <section className="rounded-xl bg-[#111319] border border-[#222633] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#eceef4] flex items-center gap-2">
                <Key size={15} className="text-[#4f8cff]" />
                <span>{t.keysTitle}</span>
              </h3>
              <p className="text-xs text-[#8e95a8] mt-0.5">{t.keysSubtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowProjectInput((p) => !p)}
                className="px-3 py-1.5 rounded-lg bg-[#171a22] hover:bg-[#222633] border border-[#222633] text-xs font-medium text-[#eceef4] transition-colors"
              >
                {t.btnNewProject}
              </button>
              <button
                type="button"
                onClick={() => setShowKeyForm((p) => !p)}
                className="px-3 py-1.5 rounded-lg bg-[#4f8cff] hover:bg-[#3f7cf0] text-xs font-medium text-white flex items-center gap-1.5 transition-colors"
              >
                <Plus size={14} />
                <span>{t.btnNewKey}</span>
              </button>
            </div>
          </div>

          {showProjectInput ? (
            <form
              onSubmit={handleProjectSubmit}
              className="flex items-center gap-2 bg-[#0d0f14] p-3 rounded-lg border border-[#222633]"
            >
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder={t.newProjectPlaceholder}
                className="flex-1 bg-[#171a22] border border-[#222633] rounded-md px-3 py-1.5 text-xs text-[#eceef4] outline-none focus:border-[#4f8cff]"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-[#4f8cff] hover:bg-[#3f7cf0] text-white text-xs font-medium rounded-md"
              >
                {t.btnCreateKey}
              </button>
            </form>
          ) : null}

          {showKeyForm ? (
            <form
              onSubmit={handleKeyFormSubmit}
              className="bg-[#0d0f14] border border-[#222633] rounded-lg p-4 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-[#8e95a8]">{t.keyNameLabel}</label>
                  <input
                    type="text"
                    required
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder={t.keyNamePlaceholder}
                    className="w-full bg-[#171a22] border border-[#222633] focus:border-[#4f8cff] rounded-md px-2.5 py-1.5 text-xs text-[#eceef4] outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-[#8e95a8]">{t.projectLabel}</label>
                  <select
                    value={newKeyProjectId}
                    onChange={(e) => setNewKeyProjectId(e.target.value)}
                    className="w-full bg-[#171a22] border border-[#222633] rounded-md px-2.5 py-1.5 text-xs text-[#eceef4] outline-none"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-[#8e95a8]">{t.expirationLabel}</label>
                  <select
                    value={expiration}
                    onChange={(e) => setExpiration(e.target.value)}
                    className="w-full bg-[#171a22] border border-[#222633] rounded-md px-2.5 py-1.5 text-xs text-[#eceef4] outline-none"
                  >
                    <option value="never">{t.expNever}</option>
                    <option value="1h">{t.exp1h}</option>
                    <option value="24h">{t.exp24h}</option>
                    <option value="7d">{t.exp7d}</option>
                    <option value="30d">{t.exp30d}</option>
                    <option value="90d">{t.exp90d}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-[#8e95a8]">{t.rpmLabel}</label>
                  <input
                    type="number"
                    min="1"
                    value={rpmLimit}
                    onChange={(e) => setRpmLimit(e.target.value)}
                    placeholder={t.unlimitedPlaceholder}
                    className="w-full bg-[#171a22] border border-[#222633] rounded-md px-2.5 py-1.5 text-xs text-[#eceef4] outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-[#8e95a8]">{t.dailyReqLabel}</label>
                  <input
                    type="number"
                    min="1"
                    value={dailyReqLimit}
                    onChange={(e) => setDailyReqLimit(e.target.value)}
                    placeholder={t.unlimitedPlaceholder}
                    className="w-full bg-[#171a22] border border-[#222633] rounded-md px-2.5 py-1.5 text-xs text-[#eceef4] outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-[#8e95a8]">{t.dailyTokLabel}</label>
                  <input
                    type="number"
                    min="1"
                    value={dailyTokLimit}
                    onChange={(e) => setDailyTokLimit(e.target.value)}
                    placeholder={t.unlimitedPlaceholder}
                    className="w-full bg-[#171a22] border border-[#222633] rounded-md px-2.5 py-1.5 text-xs text-[#eceef4] outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="inline-flex items-center gap-2 text-xs text-[#c5cbe0] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={temporaryChats}
                    onChange={(e) => setTemporaryChats(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[#222633] bg-[#171a22] accent-[#4f8cff]"
                  />
                  <span>{t.temporaryChatsLabel}</span>
                </label>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setShowKeyForm(false)}
                    className="px-3 py-1.5 rounded-md border border-[#222633] text-xs text-[#8e95a8] hover:text-[#eceef4]"
                  >
                    {t.btnCancel}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-md bg-[#4f8cff] hover:bg-[#3f7cf0] text-xs font-medium text-white"
                  >
                    {t.btnCreateKey}
                  </button>
                </div>
              </div>
            </form>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#222633] text-[#8e95a8]">
                  <th className="py-2 pr-3 font-medium">{t.thKeyName}</th>
                  <th className="py-2 px-3 font-medium">{t.thKeyValue}</th>
                  <th className="py-2 px-3 font-medium">{t.thLimits}</th>
                  <th className="py-2 px-3 font-medium">{t.thKeyStatus}</th>
                  <th className="py-2 pl-3 text-right font-medium">{t.thActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222633]/60">
                {apiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-[#8e95a8]">
                      {t.noKeysFound}
                    </td>
                  </tr>
                ) : (
                  apiKeys.map((k) => {
                    const isExpired = Boolean(k.expires_at && new Date(k.expires_at) < new Date());
                    const limitsSummary = [
                      k.rate_limit_rpm ? `${k.rate_limit_rpm} rpm` : null,
                      k.daily_requests_limit ? `${k.daily_requests_limit}/d` : null,
                      k.daily_tokens_limit ? `${k.daily_tokens_limit} tok/d` : null
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <tr key={k.id} className="hover:bg-[#171a22]/50 transition-colors">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-[#eceef4]">{k.name}</div>
                          <div className="text-[11px] text-[#8e95a8]">{k.projects?.name || "Personal"}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[#c5cbe0]">
                          <div className="flex items-center gap-2">
                            <span className="truncate max-w-[160px]">{k.key}</span>
                            <CopyButton value={k.key} copyLabel={t.copyBtn} copiedLabel={t.copied} />
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[#8e95a8] font-mono tabular-nums">{limitsSummary || "—"}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              isExpired
                                ? "bg-amber-500/15 text-amber-300"
                                : k.active
                                  ? "bg-emerald-500/15 text-emerald-300"
                                  : "bg-rose-500/15 text-rose-300"
                            }`}
                          >
                            {isExpired ? t.statusExpired : k.active ? t.statusActive : t.statusDisabled}
                          </span>
                        </td>
                        <td className="py-2.5 pl-3 text-right space-x-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onToggleTemporaryChats(k.id, k.temporary_chats ?? true)}
                            className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                              (k.temporary_chats ?? true)
                                ? "border-[#4f8cff]/30 bg-[#4f8cff]/10 text-[#9ec2ff]"
                                : "border-[#222633] text-[#8e95a8] hover:text-[#eceef4]"
                            }`}
                            title={t.temporaryChatsLabel}
                          >
                            {(k.temporary_chats ?? true) ? t.tempChatBadgeOn : t.tempChatBadgeOff}
                          </button>
                          <button
                            type="button"
                            disabled={isExpired}
                            onClick={() => onToggleKey(k.id, k.active)}
                            className="text-xs text-[#8e95a8] hover:text-[#eceef4] px-2 py-1 rounded border border-[#222633] disabled:opacity-40"
                          >
                            {k.active ? t.btnDisable : t.btnEnable}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteKey(k.id)}
                            aria-label={t.btnDelete}
                            title={t.btnDelete}
                            className="p-1.5 text-[#8e95a8] hover:text-rose-400 rounded border border-transparent hover:border-rose-500/30 transition-colors align-middle"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 4. Google Session Cookies */}
        <section className="rounded-xl bg-[#111319] border border-[#222633] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#eceef4] flex items-center gap-2">
                <Cookie size={15} className="text-[#4f8cff]" />
                <span>{t.cookiesTitle}</span>
              </h3>
              <p className="text-xs text-[#8e95a8] mt-0.5">{t.cookiesSubtitle}</p>
            </div>
            {cookieStatus ? (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                  cookieStatus.isValid ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                }`}
              >
                {cookieStatus.isValid ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
                <span>{cookieStatus.isValid ? t.cookieOk : t.cookieMissing}</span>
              </span>
            ) : null}
          </div>

          <div className="rounded-lg bg-[#0d0f14] border border-[#222633] p-3 text-xs text-[#8e95a8] leading-relaxed">
            <strong className="text-[#eceef4] font-medium">{t.cookiesHowToTitle}: </strong>
            {t.cookiesHowToSteps}
          </div>

          {cookieStatus?.cookies && Object.keys(cookieStatus.cookies).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {["__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", "SAPISID"].map((name) => {
                const present = Boolean(cookieStatus.cookies[name]);
                return (
                  <span
                    key={name}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono border ${
                      present
                        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                        : "bg-[#0d0f14] border-[#222633] text-[#8e95a8]"
                    }`}
                  >
                    {name}: {present ? "OK" : "—"}
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="space-y-2.5">
            <textarea
              rows={3}
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder={t.cookieInputPlaceholder}
              className="w-full bg-[#0d0f14] border border-[#222633] focus:border-[#4f8cff] rounded-lg px-3 py-2 text-xs font-mono text-[#eceef4] placeholder-[#8e95a8]/60 outline-none resize-y"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-[#8e95a8]">{t.cookieSavedHint}</span>
              <button
                type="button"
                disabled={isSavingCookie || !cookieInput.trim()}
                onClick={handleCookieSubmit}
                className="px-4 py-1.5 rounded-lg bg-[#4f8cff] hover:bg-[#3f7cf0] disabled:opacity-40 text-xs font-medium text-white flex items-center gap-1.5 transition-colors"
              >
                {isSavingCookie ? <RefreshCw size={13} className="animate-spin" /> : null}
                <span>{isSavingCookie ? t.btnCheckingCookies : t.btnSaveCookies}</span>
              </button>
            </div>

            {cookieFeedback ? (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  cookieFeedback.success
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                }`}
              >
                {cookieFeedback.message}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
