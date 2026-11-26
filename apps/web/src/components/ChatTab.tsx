"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Send,
  Bot,
  User,
  Sparkles,
  ImagePlus,
  X,
  Square,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { translations, Language } from "../utils/i18n";
import MarkdownContent from "./MarkdownContent";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  image?: string;
}

interface ChatTabProps {
  messages: ChatMessage[];
  input: string;
  setInput: (input: string) => void;
  isLoading: boolean;
  cookieValid: boolean | null;
  onGoToConnect: () => void;
  handleSubmit: (textOverride?: string, image?: string) => Promise<void>;
  handleStop: () => void;
  lang: Language;
}

function MessageCopyButton({ value, copiedLabel, title }: { value: string; copiedLabel: string; title: string }) {
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
      title={copied ? copiedLabel : title}
      aria-label={copied ? copiedLabel : title}
      className="inline-flex items-center justify-center p-1.5 rounded-md text-[#8e95a8] hover:text-[#eceef4] hover:bg-[#1d212c] transition-colors"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  );
}

function MessageBubble({
  msg,
  isGeneratingHere,
  isStreamingThis,
  t
}: {
  msg: ChatMessage;
  isGeneratingHere: boolean;
  isStreamingThis: boolean;
  t: (typeof translations)[Language];
}) {
  const isUser = msg.role === "user";
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || expanded) return;
    const check = () => {
      setIsOverflowing(el.scrollHeight > el.clientHeight + 4);
    };
    const raf = requestAnimationFrame(check);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [msg.content, msg.image, expanded]);

  const canCopy = Boolean(msg.content.trim()) && !isStreamingThis;
  const showFooter = canCopy || isOverflowing || expanded;

  return (
    <div className={`flex gap-3.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <div className="h-7 w-7 rounded-lg bg-[#4f8cff]/15 border border-[#4f8cff]/30 text-[#4f8cff] flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={14} />
        </div>
      ) : null}

      <div
        className={`min-w-0 overflow-hidden border border-[#222633] rounded-2xl px-4 py-3 text-sm text-[#eceef4] ${
          isUser ? "max-w-[82%] bg-[#171a22] rounded-tr-sm" : "max-w-[88%] flex-1 bg-[#111319] rounded-tl-sm"
        }`}
      >
        {isGeneratingHere ? (
          <div className="flex items-center gap-2 text-xs text-[#8e95a8] py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#4f8cff] animate-pulse" />
            <span>{t.generating}</span>
          </div>
        ) : (
          <div ref={contentRef} className={`min-w-0 ${!expanded ? "max-h-32 overflow-hidden relative" : ""}`}>
            {msg.image ? (
              <div className="mb-2">
                <Image
                  src={msg.image}
                  alt="Attached content"
                  width={400}
                  height={300}
                  unoptimized
                  className="max-h-64 w-auto rounded-lg border border-[#222633] object-contain bg-black/40"
                />
              </div>
            ) : null}

            {isUser ? (
              <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] leading-relaxed select-text min-w-0">
                {msg.content}
              </div>
            ) : (
              <MarkdownContent
                content={msg.content}
                thinkingLabel={t.thinkingProcess}
                copyLabel={t.copyCode}
                copiedLabel={t.copied}
              />
            )}

            {!expanded && isOverflowing ? (
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t ${
                  isUser ? "from-[#171a22]" : "from-[#111319]"
                } to-transparent`}
              />
            ) : null}
          </div>
        )}

        {showFooter && !isGeneratingHere ? (
          <div className="mt-2 pt-1.5 border-t border-[#222633]/60 flex items-center justify-between gap-2">
            <div>
              {isOverflowing || expanded ? (
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-[#9ec2ff] hover:text-white hover:bg-[#1d212c] transition-colors"
                >
                  {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  <span>{expanded ? t.btnCollapse : t.btnExpand}</span>
                </button>
              ) : null}
            </div>

            {canCopy ? <MessageCopyButton value={msg.content} copiedLabel={t.copied} title={t.copyMessage} /> : null}
          </div>
        ) : null}
      </div>

      {isUser ? (
        <div className="h-7 w-7 rounded-lg bg-[#171a22] border border-[#222633] text-[#8e95a8] flex items-center justify-center shrink-0 mt-0.5">
          <User size={14} />
        </div>
      ) : null}
    </div>
  );
}

export default function ChatTab({
  messages,
  input,
  setInput,
  isLoading,
  cookieValid,
  onGoToConnect,
  handleSubmit,
  handleStop,
  lang
}: ChatTabProps) {
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const t = translations[lang];

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, 240);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > 240 ? "auto" : "hidden";
  }, [input]);

  const readFileAsDataUrl = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAttachedImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const onImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readFileAsDataUrl(file);
    e.target.value = "";
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          readFileAsDataUrl(file);
          break;
        }
      }
    }
  };

  const triggerSubmit = () => {
    if ((!input.trim() && !attachedImage) || isLoading) return;
    const img = attachedImage || undefined;
    setAttachedImage(null);
    handleSubmit(undefined, img);
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    triggerSubmit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      triggerSubmit();
    }
  };

  const starters = [t.starter1, t.starter2, t.starter3];

  return (
    <div className="flex-1 flex flex-col justify-between bg-[#0a0b0e] overflow-hidden pb-14 md:pb-0">
      {/* Cookie warning banner when session cookie is invalid */}
      {cookieValid === false ? (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 md:px-6 py-2 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertCircle size={14} className="shrink-0" />
            <span>{t.chatCookieNotice}</span>
          </div>
          <button
            type="button"
            onClick={onGoToConnect}
            className="shrink-0 text-xs font-medium text-amber-200 underline hover:text-white"
          >
            {t.chatGoToConnect}
          </button>
        </div>
      ) : null}

      {/* Conversation feed */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 pt-6 pb-10 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-6">
            <div className="p-3 bg-[#111319] border border-[#222633] rounded-xl text-[#4f8cff]">
              <Sparkles size={24} />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-[#eceef4]">{t.chatWelcomeTitle}</h3>
              <p className="text-sm text-[#8e95a8] leading-relaxed">{t.chatWelcomeSubtitle}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 w-full text-left">
              {starters.map((promptText, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSubmit(promptText)}
                  className="p-3 rounded-lg bg-[#111319] hover:bg-[#171a22] border border-[#222633] hover:border-[#363d52] text-xs text-[#c5cbe0] leading-relaxed transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8cff]"
                >
                  {promptText}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto w-full">
            {messages.map((msg, idx) => {
              const isLast = idx === messages.length - 1;
              const isStreamingThis = isLoading && isLast && msg.role === "assistant";
              const isGeneratingHere = isStreamingThis && !msg.content && !msg.image;
              return (
                <MessageBubble
                  key={idx}
                  msg={msg}
                  isGeneratingHere={isGeneratingHere}
                  isStreamingThis={isStreamingThis}
                  t={t}
                />
              );
            })}
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Input Dock: fixed-height background bar while only the input box grows upward */}
      <div className="relative border-t border-[#222633]/80 bg-[#0d0f14] shrink-0">
        <div className="px-4 md:px-6 py-3 md:py-4">
          <form onSubmit={onFormSubmit} className="max-w-3xl mx-auto space-y-2">
            {attachedImage ? (
              <div className="relative inline-block border border-[#4f8cff]/40 rounded-lg p-1 bg-[#111319]">
                <Image
                  src={attachedImage}
                  alt="Preview"
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 object-cover rounded"
                />
                <button
                  type="button"
                  onClick={() => setAttachedImage(null)}
                  aria-label={t.removeImageTooltip}
                  className="absolute -top-2 -right-2 bg-[#171a22] text-[#eceef4] hover:bg-rose-600 rounded-full p-0.5 border border-[#222633] transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}

            <div className="flex items-end gap-2 bg-[#111319] border border-[#222633] focus-within:border-[#4f8cff] rounded-xl p-2 shadow-lg shadow-black/35 transition-colors">
              <input type="file" ref={fileInputRef} onChange={onImageSelect} accept="image/*" className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-[#8e95a8] hover:text-[#eceef4] hover:bg-[#171a22] rounded-lg transition-colors"
                title={t.attachImageTooltip}
                aria-label={t.attachImageTooltip}
              >
                <ImagePlus size={16} />
              </button>

              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder={t.inputPlaceholder}
                className="flex-1 bg-transparent text-sm text-[#eceef4] placeholder-[#8e95a8]/70 resize-none outline-none py-1.5 px-1 min-h-[34px] max-h-[240px] custom-scrollbar leading-relaxed"
              />

              {isLoading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-lg transition-colors text-xs font-medium flex items-center gap-1.5"
                >
                  <Square size={12} fill="currentColor" />
                  <span>{t.btnStop}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && !attachedImage}
                  className="px-3 py-1.5 bg-[#4f8cff] hover:bg-[#3f7cf0] text-white disabled:opacity-35 rounded-lg transition-colors text-xs font-medium flex items-center gap-1.5"
                >
                  <Send size={13} />
                  <span className="hidden sm:inline">{t.btnSend}</span>
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
