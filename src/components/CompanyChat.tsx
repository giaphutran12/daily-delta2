"use client";

import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Markdown from "react-markdown";
import { MessageSquare, Send, Loader2, Minus, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getChatMessages, getAuthHeaders } from "@/lib/api/client";

export function CompanyChat({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useChat({
    id: `chat-${companyId}`,
    transport: new DefaultChatTransport({
      api: `/api/chat/${companyId}`,
      headers: async () => await getAuthHeaders(),
    }),
    messages: [],
  });

  const { error, messages, sendMessage, setMessages, status } = chat;
  const isStreaming = status === "streaming" || status === "submitted";

  // Load persisted messages on mount
  useEffect(() => {
    let isActive = true;

    setLoadingHistory(true);
    setHistoryError(null);

    getChatMessages(companyId)
      .then(({ messages }) => {
        if (!isActive) return;
        setMessages(messages as UIMessage[]);
      })
      .catch((err) => {
        if (!isActive) return;
        setMessages([]);
        setHistoryError(
          err instanceof Error ? err.message : "Failed to load chat history.",
        );
      })
      .finally(() => {
        if (isActive) setLoadingHistory(false);
      });

    return () => {
      isActive = false;
    };
  }, [companyId, setMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  return (
    <div className="fixed bottom-5 right-5 z-50" style={{ transformOrigin: "bottom right" }}>
      {/* Collapsed pill */}
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 rounded-full border border-border/50 bg-background/80 px-4 py-2.5 text-sm text-muted-foreground shadow-lg backdrop-blur-xl transition-all duration-300 ease-out hover:bg-background/90 hover:text-foreground hover:shadow-xl hover:-translate-y-0.5 ${
          isOpen ? "pointer-events-none scale-0 opacity-0" : "scale-100 opacity-100"
        }`}
      >
        <MessageSquare className="h-4 w-4" />
        Ask questions about this data
      </button>

      {/* Expanded panel */}
      <div
        className={`absolute bottom-0 right-0 flex w-[36rem] flex-col rounded-2xl border border-border/50 bg-background/80 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-out max-sm:w-[calc(100vw-2.5rem)] ${
          isOpen
            ? "scale-100 opacity-100 h-[700px] max-h-[calc(100vh-3rem)]"
            : "pointer-events-none scale-75 opacity-0 h-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/30 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate">
              Chat &middot; {companyName}
            </span>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setIsOpen(false)}
          >
            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        >
          {(historyError || error) && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {historyError ?? error?.message ?? "Chat request failed."}
            </div>
          )}

          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Ask anything about {companyName}&apos;s signals
              </p>
              <p className="text-xs text-muted-foreground/60">
                e.g. &ldquo;Summarize recent hiring trends&rdquo;
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return message.role === "assistant" ? (
                        <div key={i} className="chat-markdown">
                          <Markdown>{part.text}</Markdown>
                        </div>
                      ) : (
                        <span key={i} className="whitespace-pre-wrap">
                          {part.text}
                        </span>
                      );
                    }

                    // Tool invocation indicator
                    const toolPart = part as { type: string; toolName?: string; state?: string };
                    if (toolPart.type.startsWith("tool-") || toolPart.type === "dynamic-tool") {
                      const name = toolPart.toolName ?? toolPart.type.replace("tool-", "");
                      const isRunning = toolPart.state === "call" || toolPart.state === "partial-call";
                      const Icon = name.includes("search") ? Search : Filter;
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground/70 py-1"
                        >
                          {isRunning ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Icon className="h-3 w-3" />
                          )}
                          <span>
                            {name === "search_signals" ? "Searching signals" : "Filtering signals"}
                            {isRunning ? "..." : " done"}
                          </span>
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              </div>
            ))
          )}

          {isStreaming && messages.at(-1)?.role !== "assistant" && (
            <div className="flex justify-start">
              <div className="rounded-xl bg-muted px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-t border-border/30 px-3 py-2.5 shrink-0"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about signals..."
            disabled={isStreaming || loadingHistory}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="ghost"
            disabled={!input.trim() || isStreaming}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
