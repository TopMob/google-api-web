"use client";

import React, { useState } from "react";
import { Server, Key, Cpu, FileCode, Check, Copy, Terminal, ChevronDown } from "lucide-react";
import { translations, Language } from "../utils/i18n";

interface QuickCopyBarProps {
  gatewayUrl: string;
  activeKey: string;
  selectedModel: string;
  lang: Language;
}

export default function QuickCopyBar({ gatewayUrl, activeKey, selectedModel, lang }: QuickCopyBarProps) {
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const t = translations[lang];
  const baseUrl = `${gatewayUrl.replace(/\/$/, "")}/v1`;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(id);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  const copyEnvConfig = () => {
    const content = `OPENAI_BASE_URL=${baseUrl}\nOPENAI_API_KEY=${activeKey || "your_api_key_here"}\nOPENAI_MODEL=${selectedModel || "gemini-3.8-flash"}`;
    handleCopy(content, "env");
    setShowExportMenu(false);
  };

  const copyCurlConfig = () => {
    const content = `curl ${baseUrl}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${activeKey || "gw_key"}" \\\n  -d '{\n    "model": "${selectedModel || "gemini-3.8-flash"}",\n    "messages": [{"role": "user", "content": "Hello Gemini"}]\n  }'`;
    handleCopy(content, "curl");
    setShowExportMenu(false);
  };

  return (
    <div className="bg-[#0a0b10] border-b border-zinc-850 px-6 py-2 flex flex-wrap items-center justify-between gap-3 select-none shrink-0 font-mono text-[11px]">
      {/* Label / Badge */}
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
        <span className="font-bold text-zinc-300 uppercase tracking-wider text-[10px]">{t.quickCopyTitle}</span>
      </div>

      {/* Copy Actions Group */}
      <div className="flex items-center flex-wrap gap-2">
        {/* Gateway Base URL */}
        <button
          onClick={() => handleCopy(baseUrl, "gateway")}
          className="group flex items-center gap-1.5 bg-[#0e1017] hover:bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 rounded px-2.5 py-1 text-zinc-300 transition"
          title={t.copyGateway}
        >
          <Server size={12} className="text-cyan-400 group-hover:scale-110 transition-transform" />
          <span className="text-zinc-500 text-[10px]">Gateway:</span>
          <span className="text-zinc-200 font-bold max-w-[140px] truncate">{baseUrl}</span>
          {copiedItem === "gateway" ? (
            <Check size={12} className="text-emerald-400 ml-1 shrink-0" />
          ) : (
            <Copy size={11} className="text-zinc-500 group-hover:text-zinc-300 ml-1 shrink-0" />
          )}
        </button>

        {/* API Key */}
        <button
          onClick={() => handleCopy(activeKey, "key")}
          disabled={!activeKey}
          className="group flex items-center gap-1.5 bg-[#0e1017] hover:bg-zinc-900 border border-zinc-800 hover:border-amber-500/40 rounded px-2.5 py-1 text-zinc-300 transition disabled:opacity-40"
          title={t.copyKey}
        >
          <Key size={12} className="text-amber-400 group-hover:scale-110 transition-transform" />
          <span className="text-zinc-500 text-[10px]">Key:</span>
          <span className="text-zinc-200 font-bold max-w-[120px] truncate">
            {activeKey ? (activeKey.length > 14 ? `${activeKey.slice(0, 10)}...` : activeKey) : "None"}
          </span>
          {copiedItem === "key" ? (
            <Check size={12} className="text-emerald-400 ml-1 shrink-0" />
          ) : (
            <Copy size={11} className="text-zinc-500 group-hover:text-zinc-300 ml-1 shrink-0" />
          )}
        </button>

        {/* Model */}
        <button
          onClick={() => handleCopy(selectedModel, "model")}
          disabled={!selectedModel}
          className="group flex items-center gap-1.5 bg-[#0e1017] hover:bg-zinc-900 border border-zinc-800 hover:border-purple-500/40 rounded px-2.5 py-1 text-zinc-300 transition disabled:opacity-40"
          title={t.copyModel}
        >
          <Cpu size={12} className="text-purple-400 group-hover:scale-110 transition-transform" />
          <span className="text-zinc-500 text-[10px]">Model:</span>
          <span className="text-zinc-200 font-bold max-w-[150px] truncate">{selectedModel || "None"}</span>
          {copiedItem === "model" ? (
            <Check size={12} className="text-emerald-400 ml-1 shrink-0" />
          ) : (
            <Copy size={11} className="text-zinc-500 group-hover:text-zinc-300 ml-1 shrink-0" />
          )}
        </button>

        {/* Export Bundle Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu((prev) => !prev)}
            className="flex items-center gap-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded px-2.5 py-1 transition"
            title="Export full configuration"
          >
            <FileCode size={12} />
            <span className="text-[10px] font-bold">Bundle</span>
            <ChevronDown size={11} className={`transition-transform ${showExportMenu ? "rotate-180" : ""}`} />
          </button>

          {showExportMenu && (
            <div className="absolute right-0 mt-1 w-48 bg-[#0d0e12] border border-zinc-800 rounded shadow-xl py-1 z-50">
              <button
                onClick={copyEnvConfig}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-zinc-800 transition"
              >
                <FileCode size={13} className="text-emerald-400" />
                <span>{t.copyBundleEnv}</span>
              </button>
              <button
                onClick={copyCurlConfig}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] text-zinc-300 hover:bg-zinc-800 transition"
              >
                <Terminal size={13} className="text-cyan-400" />
                <span>{t.copyBundleCurl}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
