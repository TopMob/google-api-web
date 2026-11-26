"use client";

import React from "react";
import Image from "next/image";
import { MessageSquare, Plug, Activity } from "lucide-react";
import { translations, Language } from "../utils/i18n";

export type TabType = "chat" | "connect" | "logs";

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  gatewayStatus: "online" | "warning" | "offline" | "checking";
  cookieValid: boolean | null;
  cookieHasFile: boolean | null;
  lang: Language;
  setLang: (lang: Language) => void;
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  gatewayStatus,
  cookieValid,
  cookieHasFile,
  lang,
  setLang
}: SidebarProps) {
  const t = translations[lang];

  const tabs: Array<{
    id: TabType;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }> = [
    { id: "chat", label: t.tabChat, icon: MessageSquare },
    { id: "connect", label: t.tabConnect, icon: Plug },
    { id: "logs", label: t.tabLogs, icon: Activity }
  ];

  const statusColor =
    gatewayStatus === "online"
      ? "bg-emerald-500"
      : gatewayStatus === "warning"
        ? "bg-amber-400"
        : gatewayStatus === "offline"
          ? "bg-rose-500"
          : "bg-zinc-400";

  const statusText =
    gatewayStatus === "online"
      ? t.statusOnline
      : gatewayStatus === "warning"
        ? t.statusWarning
        : gatewayStatus === "offline"
          ? t.statusOffline
          : t.statusChecking;

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-60 border-r border-[#222633] bg-[#0d0f14] flex-col justify-between p-4 select-none shrink-0">
        <div className="space-y-6">
          {/* Brand */}
          <div className="flex items-center gap-3 px-1.5 pt-1">
            <Image
              src="/logo.webp"
              alt="Gemini Gateway"
              width={32}
              height={32}
              className="h-8 w-8 rounded-lg border border-[#222633] object-cover shrink-0"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#eceef4] truncate">{t.brandTitle}</div>
              <div className="text-xs text-[#8e95a8] truncate">{t.brandSubtitle}</div>
            </div>
          </div>

          {/* 3 Clean Tabs */}
          <nav aria-label="Main navigation" className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8cff] ${
                    isActive
                      ? "bg-[#4f8cff]/15 text-[#eceef4] border border-[#4f8cff]/30"
                      : "text-[#8e95a8] hover:text-[#eceef4] hover:bg-[#171a22] border border-transparent"
                  }`}
                >
                  <Icon size={16} className={isActive ? "text-[#4f8cff]" : "text-[#8e95a8]"} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Status & Language */}
        <div className="space-y-2.5 pt-4 border-t border-[#222633] text-xs">
          <div className="rounded-lg bg-[#111319] border border-[#222633] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[#8e95a8]">{t.gatewayLabel}</span>
              <span className="flex items-center gap-1.5 font-medium text-[#eceef4]">
                <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                {statusText}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8e95a8]">{t.cookieLabel}</span>
              <span
                className={`font-medium ${
                  cookieValid === true
                    ? "text-emerald-400"
                    : cookieValid === false
                      ? "text-amber-400"
                      : "text-[#8e95a8]"
                }`}
              >
                {cookieValid === true
                  ? t.cookieOk
                  : cookieValid === false
                    ? cookieHasFile
                      ? t.cookieExpired
                      : t.cookieMissing
                    : cookieHasFile === false
                      ? t.cookieMissing
                      : "—"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <span className="text-[#8e95a8]">Язык / Lang</span>
            <div className="inline-flex rounded-md bg-[#111319] border border-[#222633] p-0.5">
              <button
                type="button"
                onClick={() => setLang("ru")}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  lang === "ru" ? "bg-[#4f8cff]/20 text-[#eceef4]" : "text-[#8e95a8] hover:text-[#eceef4]"
                }`}
              >
                RU
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  lang === "en" ? "bg-[#4f8cff]/20 text-[#eceef4]" : "text-[#8e95a8] hover:text-[#eceef4]"
                }`}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-14 bg-[#0d0f14]/95 backdrop-blur border-t border-[#222633] flex items-center justify-around px-2"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                isActive ? "text-[#4f8cff]" : "text-[#8e95a8]"
              }`}
            >
              <Icon size={17} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
