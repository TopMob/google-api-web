"use client";

import React, { useEffect, useRef } from "react";
import { Send, Bot, User, Sparkles } from "lucide-react";

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
}

export default function PlaygroundTab({
  messages,
  input,
  setInput,
  isLoading,
  handleSubmit,
  gatewayStatus
}: PlaygroundTabProps) {
  const chatBottomRef = useRef<HTMLDivElement>(null);

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
              <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Gateway Playground</h2>
              <p className="text-[11px] text-zinc-400 leading-relaxed font-mono">
                Submit raw completions directly to your local Fastify gateway. This playground interacts with the Google
                Web session using OpenAI schema compatibility.
              </p>
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
                  {/* Header Row */}
                  <div className="flex items-center gap-2 select-none">
                    {isUser ? (
                      <>
                        <User size={12} className="text-cyan-400" />
                        <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider">
                          [User_Shell]
                        </span>
                      </>
                    ) : (
                      <>
                        <Bot size={12} className="text-emerald-400" />
                        <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider">
                          [Gemini_Response]
                        </span>
                      </>
                    )}
                  </div>

                  {/* Message Content */}
                  <div
                    className={`rounded border p-4 text-[11px] leading-relaxed font-mono ${
                      isUser
                        ? "bg-[#0b0c0e]/60 border-zinc-850 text-zinc-200"
                        : "bg-[#0c0d10] border-zinc-800 text-zinc-100 shadow-[inset_0_1px_3px_rgba(0,0,0,0.2)]"
                    }`}
                  >
                    <div className="whitespace-pre-wrap select-text">{msg.content}</div>
                  </div>
                </div>
              );
            })}

            {/* Loading Indicator */}
            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex flex-col space-y-1.5 border-t border-zinc-900 pt-4">
                <div className="flex items-center gap-2 select-none">
                  <Bot size={12} className="text-zinc-500" />
                  <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">
                    [Awaiting_Stream]
                  </span>
                </div>
                <div className="rounded border border-dashed border-zinc-800 bg-[#08090b] p-4 flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
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
                gatewayStatus === "online"
                  ? "Enter query to pass upstream..."
                  : "Gateway offline. Awaiting node link..."
              }
              disabled={isLoading || gatewayStatus !== "online"}
              className="flex-grow bg-transparent border-0 outline-none text-xs font-mono px-3 py-2 text-zinc-200 placeholder-zinc-600 disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim() || gatewayStatus !== "online"}
              className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 rounded px-4 py-2 text-xs font-mono transition duration-150 disabled:opacity-20 shrink-0"
            >
              <div className="flex items-center gap-1.5">
                <Send size={11} />
                <span>Execute</span>
              </div>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
