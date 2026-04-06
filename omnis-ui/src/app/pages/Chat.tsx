import { useState, useEffect, useRef } from "react";
import { Send, Paperclip, ChevronDown, Square, ChevronRight, ChevronLeft } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: { id: number; title: string; excerpt: string; relevance: number; page: number }[];
  agentStatus?: { step: string; status: "active" | "completed" | "waiting" }[];
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentTab, setCurrentTab] = useState<"sources" | "trace" | "graph">("sources");
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText]);

  const simulateStreaming = (text: string) => {
    setIsStreaming(true);
    setStreamingText("");
    let index = 0;
    const interval = setInterval(() => {
      if (index < text.length) {
        const chunk = text.substring(index, Math.min(index + Math.floor(Math.random() * 8) + 5, text.length));
        setStreamingText((prev) => prev + chunk);
        index += chunk.length;
      } else {
        clearInterval(interval);
        setIsStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: text,
            citations: [
              { id: 1, title: "Introduction to Neural Networks", excerpt: "Neural networks are computing systems inspired by biological neural networks...", relevance: 94, page: 12 },
              { id: 2, title: "Deep Learning Fundamentals", excerpt: "The architecture of deep neural networks allows for hierarchical feature learning...", relevance: 87, page: 45 },
              { id: 3, title: "Machine Learning Basics", excerpt: "Supervised learning requires labeled training data to build predictive models...", relevance: 73, page: 8 }
            ]
          },
        ]);
        setStreamingText("");
      }
    }, 40);
  };

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    setTimeout(() => {
      const response =
        "Neural networks are computational models inspired by the biological neural networks in animal brains. They consist of interconnected nodes (neurons) organized in layers. Each connection has a weight that adjusts as learning proceeds, allowing the network to recognize patterns in data [1]. Deep learning extends this concept by using multiple hidden layers, enabling the network to learn hierarchical representations of features [2]. This architecture has proven particularly effective for tasks like image recognition, natural language processing, and game playing [3].";
      simulateStreaming(response);
    }, 500);
  };

  const suggestedQuestions = [
    "What are the key principles of RAG systems?",
    "Explain how knowledge graphs improve retrieval",
    "How does multi-hop reasoning work?",
    "Best practices for document chunking strategies"
  ];

  return (
    <div className="h-full flex">
      {/* Chat Column */}
      <div className="flex-1 flex flex-col relative">
        <div className="flex-1 overflow-y-auto px-12">
          <div className="max-w-[720px] mx-auto py-8">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none" className="mb-6">
                  <circle cx="32" cy="16" r="6" fill="var(--accent-teal)" opacity="0.8" />
                  <circle cx="16" cy="44" r="6" fill="var(--accent-teal)" opacity="0.8" />
                  <circle cx="48" cy="44" r="6" fill="var(--accent-teal)" opacity="0.8" />
                  <line x1="32" y1="22" x2="20" y2="38" stroke="var(--accent-teal)" strokeWidth="2" opacity="0.6" />
                  <line x1="32" y1="22" x2="44" y2="38" stroke="var(--accent-teal)" strokeWidth="2" opacity="0.6" />
                  <line x1="22" y1="44" x2="42" y2="44" stroke="var(--accent-teal)" strokeWidth="2" opacity="0.6" />
                </svg>
                <h1 className="mb-8" style={{ fontFamily: 'var(--font-display)', fontSize: '28px', color: 'var(--text-primary)' }}>
                  What would you like to know?
                </h1>
                <div className="grid grid-cols-2 gap-3 w-full max-w-[600px]">
                  {suggestedQuestions.map((question, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(question)}
                      className="p-4 rounded-lg text-left transition-all duration-200 hover:scale-[1.02]"
                      style={{
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px'
                      }}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div key={message.id} className="mb-6">
                    {message.role === "user" ? (
                      <div className="flex justify-end">
                        <div
                          className="max-w-[60%] px-4 py-3 rounded-2xl"
                          style={{
                            background: 'var(--elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: '16px 16px 4px 16px',
                            color: 'var(--text-primary)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '13px'
                          }}
                        >
                          {message.content}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full">
                        <div
                          className="prose prose-invert max-w-none"
                          style={{
                            fontFamily: 'var(--font-body)',
                            fontSize: '16px',
                            lineHeight: '1.75',
                            color: 'var(--text-primary)'
                          }}
                        >
                          {message.content}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isStreaming && (
                  <div className="w-full">
                    {/* Agent Status Bar */}
                    <div className="flex items-center gap-4 mb-4 text-[11px]" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-teal)', boxShadow: '0 0 6px var(--accent-teal)' }} />
                        <span style={{ color: 'var(--text-primary)' }}>Researcher</span>
                      </div>
                      <div className="w-8 h-px" style={{ background: 'var(--border)' }} />
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full border" style={{ borderColor: 'var(--border)' }} />
                        <span>Coder</span>
                      </div>
                      <div className="w-8 h-px" style={{ background: 'var(--border)' }} />
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full border" style={{ borderColor: 'var(--border)' }} />
                        <span>Reviewer</span>
                      </div>
                    </div>
                    <div
                      className="prose prose-invert max-w-none"
                      style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: '16px',
                        lineHeight: '1.75',
                        color: 'var(--text-primary)'
                      }}
                    >
                      {streamingText}
                      <span
                        className="inline-block w-0.5 h-5 ml-0.5 animate-pulse"
                        style={{ background: 'var(--accent-teal)' }}
                      />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        </div>

        {/* Message Composer */}
        <div className="p-6">
          <div className="max-w-[720px] mx-auto">
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'var(--elevated)',
                border: '1px solid var(--border)',
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask about your knowledge base..."
                className="w-full bg-transparent border-0 outline-none resize-none"
                style={{
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  minHeight: '60px'
                }}
              />
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <button
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Paperclip size={16} />
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors text-[11px]"
                    style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                  >
                    Select model <ChevronDown size={12} />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {input.length} chars
                  </span>
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isStreaming}
                    className="px-4 py-2 rounded-xl flex items-center gap-2 transition-all disabled:opacity-50"
                    style={{
                      background: isStreaming ? 'var(--danger)' : 'var(--accent-teal)',
                      color: 'var(--background)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px'
                    }}
                  >
                    {isStreaming ? <Square size={14} /> : <Send size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Context Panel */}
      <div
        className="flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden"
        style={{
          width: rightCollapsed ? '36px' : '360px',
          borderLeft: '1px solid var(--border)'
        }}
      >
        {rightCollapsed ? (
          /* Collapsed strip */
          <button
            onClick={() => setRightCollapsed(false)}
            className="flex-1 flex flex-col items-center justify-center gap-3 transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            title="Expand panel"
          >
            <ChevronLeft size={14} />
            <span
              className="text-[10px] tracking-widest"
              style={{ fontFamily: 'var(--font-mono)', writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: 'var(--text-tertiary)' }}
            >
              SOURCES
            </span>
          </button>
        ) : (
          <>
            {/* Tabs */}
            <div
              className="flex border-b items-center"
              style={{ borderColor: 'var(--border)' }}
            >
              {["sources", "trace", "graph"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCurrentTab(tab as any)}
                  className="flex-1 py-3 text-[11px] uppercase tracking-wider transition-colors"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: currentTab === tab ? 'var(--accent-teal)' : 'var(--text-secondary)',
                    borderBottom: currentTab === tab ? '2px solid var(--accent-teal)' : '2px solid transparent'
                  }}
                >
                  {tab}
                </button>
              ))}
              {/* Collapse button */}
              <button
                onClick={() => setRightCollapsed(true)}
                className="px-3 py-3 transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
                title="Collapse panel"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {currentTab === "sources" && messages.length > 0 && messages[messages.length - 1].role === "assistant" && (
                <>
                  {messages[messages.length - 1].citations?.map((citation) => (
                    <div
                      key={citation.id}
                      className="p-3.5 rounded-lg transition-all duration-200 hover:scale-[1.01]"
                      style={{
                        background: 'var(--elevated)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{
                            background: 'rgba(0, 217, 192, 0.15)',
                            color: 'var(--accent-teal)',
                            fontFamily: 'var(--font-mono)'
                          }}
                        >
                          [{citation.id}]
                        </span>
                        <span
                          className="text-[12px] font-medium"
                          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                        >
                          {citation.title}
                        </span>
                      </div>
                      <p
                        className="text-[13px] mb-2 line-clamp-2"
                        style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', opacity: 0.7 }}
                      >
                        {citation.excerpt}
                      </p>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 h-1 rounded-full overflow-hidden mr-3" style={{ background: 'var(--border)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{ background: 'var(--accent-amber)', width: `${citation.relevance}%` }}
                          />
                        </div>
                        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          p.{citation.page}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {currentTab === "trace" && (
                <div className="space-y-2">
                  <div className="p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-teal)' }} />
                      <span className="text-[12px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>Retrieval</span>
                      <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>124ms</span>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-indigo)' }} />
                      <span className="text-[12px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>LLM Call</span>
                      <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>1.8s</span>
                    </div>
                  </div>
                  <div className="p-2 rounded text-[11px] text-right" style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
                    Total: $0.0043
                  </div>
                </div>
              )}
              {currentTab === "graph" && (
                <div className="text-center py-12" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                  Mini graph visualization would appear here
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}