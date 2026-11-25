"use client";

import React, { useState } from "react";
import { RefreshCw, MessageSquare, Plug, Activity } from "lucide-react";
import { translations, Language } from "../utils/i18n";
import { TabType } from "./Sidebar";

interface HeaderProps {
  activeTab: TabType;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: string[];
  fetchModels: () => Promise<void>;
  thinkDepth: "auto" | "0" | "4";
  setThinkDepth: (depth: "auto" | "0" | "4") => void;
  lang: Language;
}

export default function Header({
  activeTab,
  selectedModel,
  setSelectedModel,
  models,
  fetchModels,
  thinkDepth,
  setThinkDepth,
  lang
}: HeaderProps) {
  const t = translations[lang];
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [customInputMode, setCustomInputMode] = useState(false);

  const tabMeta =
    activeTab === "chat"
      ? { label: t.tabChat, icon: MessageSquare }
      : activeTab === "connect"
        ? { label: t.tabConnect, icon: Plug }
        : { label: t.tabLogs, icon: Activity };

  const Icon = tabMeta.icon;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchModels();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <header className="h-14 border-b border-[#222633] bg-[#0d0f14] px-4 md:px-6 flex items-center justify-between gap-3 shrink-0 select-none">
      {/* Screen title */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon size={16} className="text-[#4f8cff] shrink-0" />
        <h2 className="text-sm font-semibold text-[#eceef4] truncate">{tabMeta.label}</h2>
      </div>

      {/* Model & Think controls (single canonical place, no duplicate copy buttons) */}
      <div className="flex items-center gap-2 min-w-0">
        <label htmlFor="model-selector" className="hidden sm:inline text-xs text-[#8e95a8]">
          {t.modelLabel}
        </label>

        {customInputMode ? (
          <input
            id="model-selector"
            type="text"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            placeholder={t.customModelPlaceholder}
            className="bg-[#171a22] border border-[#4f8cff]/50 focus:border-[#4f8cff] rounded-lg px-2.5 py-1 text-xs font-mono text-[#eceef4] outline-none w-40 sm:w-48 transition"
          />
        ) : (
          <select
            id="model-selector"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-[#171a22] border border-[#222633] hover:border-[#363d52] rounded-lg px-2.5 py-1 text-xs font-mono text-[#eceef4] outline-none transition cursor-pointer max-w-[180px] sm:max-w-xs"
          >
            {models.length === 0 ? (
              <option value="" disabled>
                {t.modelLoading}
              </option>
            ) : (
              models.map((m) => (
                <option key={m} value={m} className="bg-[#111319]">
                  {m}
                </option>
              ))
            )}
          </select>
        )}

        <button
          type="button"
          onClick={() => setCustomInputMode((prev) => !prev)}
          className="text-xs text-[#8e95a8] hover:text-[#eceef4] px-2 py-1 border border-[#222633] hover:border-[#363d52] rounded-lg transition-colors"
        >
          {customInputMode ? t.btnList : t.btnCustom}
        </button>

        {activeTab === "chat" ? (
          <select
            aria-label={t.thinkLabel}
            value={thinkDepth}
            onChange={(e) => setThinkDepth(e.target.value as "auto" | "0" | "4")}
            className="hidden sm:block bg-[#171a22] border border-[#222633] hover:border-[#363d52] rounded-lg px-2 py-1 text-xs text-[#8e95a8] outline-none cursor-pointer"
            title={t.thinkLabel}
          >
            <option value="auto" className="bg-[#111319]">
              {t.thinkLabel}: {t.thinkAuto}
            </option>
            <option value="0" className="bg-[#111319]">
              {t.thinkLabel}: {t.thinkDeep}
            </option>
            <option value="4" className="bg-[#111319]">
              {t.thinkLabel}: {t.thinkFast}
            </option>
          </select>
        ) : null}

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1.5 text-[#8e95a8] hover:text-[#eceef4] hover:bg-[#171a22] rounded-lg transition-colors disabled:opacity-50"
          title={t.btnRefreshModels}
          aria-label={t.btnRefreshModels}
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin text-[#4f8cff]" : ""} />
        </button>
      </div>
    </header>
  );
}
