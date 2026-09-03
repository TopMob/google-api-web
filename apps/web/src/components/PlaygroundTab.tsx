"use client";

import React, { useEffect, useRef, useState } from "react";
import { Send, Bot, User, Sparkles } from "lucide-react";
import { translations, Language } from "../utils/i18n";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface PlaygroundTabProps {
  messages: Message[];
  input: string;
  setInput: (input: string) => void;
  isLoading: boolean;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  gatewayStatus: "online" | "offline" | "checking";
  lang: Language;
}

export default function PlaygroundTab({
  messages,
  input,
  setInput,
  isLoading,
  handleSubmit,
  gatewayStatus,
  lang
}: PlaygroundTabProps) {
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const t = translations[lang];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex-1 flex flex-col justify-between bg-[#07080a] overflow-hidden font-sans relative">
      {/* Messages Viewport */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-5">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl relative">
              <Sparkles size={28} className="text-cyan-400" />
              <div className="absolute -inset-1 rounded-xl bg-cyan-400/5 blur-md -z-10" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
                {t.playgroundWelcomeTitle}
              </h2>
              <p className="text-[11px] text-zinc-400 leading-relaxed font-mono">{t.playgroundWelcomeSubtitle}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl mx-auto w-full">
            {messages.map((msg, idx) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={idx}
                  className={`flex flex-col space-y-1.5 border-t border-zinc-900 pt-4 first:border-0 first:pt-0`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`p-1 rounded ${
                        isUser ? "bg-zinc-800 text-zinc-300" : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                      }`}
                    >
                      {isUser ? <User size={12} /> : <Bot size={12} />}
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-zinc-400">
                      {isUser ? t.userRole : t.botRole}
                    </span>
                  </div>
                  <div className="pl-6 text-xs leading-relaxed text-zinc-200 font-mono whitespace-pre-wrap select-text">
                    {msg.content}
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-center gap-2 pl-6 pt-2">
                <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce" />
                <span className="text-[10px] font-mono text-zinc-500 ml-1">{t.thinkingBadge}</span>
              </div>
            )}
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Input Section */}
      <div className="p-6 bg-gradient-to-t from-[#07080a] via-[#07080a]/90 to-transparent">
        <div className="max-w-4xl mx-auto w-full">
          <form
            onSubmit={handleSubmit}
            className="flex items-center bg-[#0d0e12] border border-zinc-850 focus-within:border-cyan-500/50 rounded p-1.5 transition duration-200"
          >
            <span className="pl-3 pr-1 text-zinc-500 font-mono text-xs select-none">$</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                !mounted || gatewayStatus === "online"
                  ? t.inputPlaceholder
                  : "Gateway may be offline. You can still test query..."
              }
              disabled={!mounted ? false : isLoading}
              suppressHydrationWarning
              className="flex-grow bg-transparent border-0 outline-none text-xs font-mono px-3 py-2 text-zinc-200 placeholder-zinc-600 disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={!mounted ? false : isLoading || !input.trim()}
              suppressHydrationWarning
              className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 rounded px-4 py-2 text-xs font-mono transition duration-150 disabled:opacity-20 shrink-0"
            >
              <div className="flex items-center gap-1.5">
                <Send size={11} />
                <span>{t.btnSend}</span>
              </div>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
